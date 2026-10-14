"""
pid_safety_controller.py
=========================
PID-controlled safety intervention for Drug-Drug Interaction resolution.

Inspired by SafeDrug's PID-based loss function:
  Sun, J. et al. (2022). SafeDrug: Dual Molecular Graph Encoders for Safe
  Drug Recommendations. IJCAI 2022.
  Source: external_safedrug/src/SafeDrug.py

The PID controller here works at INFERENCE time (not training time),
dynamically resolving DDI conflicts by adjusting drug inclusion decisions
based on the pharmacological risk signal.

Control loop:
  - Setpoint   : target DDI rate = 0.0 (no interactions in final set)
  - Process var: current DDI rate of the proposed drug set
  - Error       : current_ddi_rate - target_ddi_rate
  - Output      : penalty scores that demote conflicting drugs

  Kp, Ki, Kd are tuned for deterministic convergence within a single
  inference call (no time dimension — we simulate discrete "steps" by
  iteratively removing the drug with the highest DDI penalty).
"""

from typing import Dict, List, Tuple
import math


class PIDSafetyController:
    """
    Proportional-Integral-Derivative controller for DDI-safe drug set resolution.

    Usage
    -----
    controller = PIDSafetyController(target_ddi_rate=0.0, kp=0.8, ki=0.1, kd=0.05)
    safe_drugs, blocked, log = controller.resolve(proposed_drugs, ddi_graph)
    """

    def __init__(
        self,
        target_ddi_rate: float = 0.0,
        kp: float = 0.8,
        ki: float = 0.1,
        kd: float = 0.05,
        max_iterations: int = 20,
    ):
        self.target = target_ddi_rate
        self.kp = kp
        self.ki = ki
        self.kd = kd
        self.max_iter = max_iterations

        # PID state
        self._integral = 0.0
        self._prev_error = 0.0

    def _compute_output(self, error: float) -> float:
        """One PID step: update state and return control output."""
        self._integral += error
        derivative = error - self._prev_error
        self._prev_error = error
        return self.kp * error + self.ki * self._integral + self.kd * derivative

    def resolve(
        self,
        proposed_drugs: Dict[str, float],
        ddi_interactions: List[Dict],
    ) -> Tuple[Dict[str, float], List[Dict]]:
        """
        Iteratively remove the most-penalised conflicting drug until
        the DDI rate reaches the target or no more conflicts exist.

        Parameters
        ----------
        proposed_drugs   : {drug_name: confidence_score} above threshold
        ddi_interactions : list of DDI dicts from DDIKnowledgeGraph.get_interactions()

        Returns
        -------
        safe_drugs      : {drug_name: confidence} — final safe prescription
        blocked_events  : list of intervention records (for the UI right panel)
        """
        self._integral = 0.0
        self._prev_error = 0.0

        current_drugs = dict(proposed_drugs)
        blocked_events = []
        active_ddis = [d for d in ddi_interactions if d["severity"] == "High"]

        for iteration in range(self.max_iter):
            # Check which active DDIs still apply to current drug set
            remaining_conflicts = [
                ddi for ddi in active_ddis
                if ddi["drug_a"] in current_drugs and ddi["drug_b"] in current_drugs
            ]

            if not remaining_conflicts:
                break  # Safe set achieved

            # Compute current DDI rate
            n = len(current_drugs)
            total_pairs = max(n * (n - 1) / 2, 1)
            current_ddi_rate = len(remaining_conflicts) / total_pairs

            # PID step
            error = current_ddi_rate - self.target
            pid_output = self._compute_output(error)

            # Compute per-drug DDI penalty scores
            penalty: Dict[str, float] = {drug: 0.0 for drug in current_drugs}
            for ddi in remaining_conflicts:
                # Penalty proportional to frequency and PID output
                ddi_penalty = pid_output * ddi.get("frequency", 0.1)
                penalty[ddi["drug_a"]] += ddi_penalty
                penalty[ddi["drug_b"]] += ddi_penalty

            # Find the drug with the highest net penalty (penalise low-confidence more)
            # net_score = confidence - penalty  → drop the drug with lowest net score
            net_score: Dict[str, float] = {
                drug: current_drugs[drug] - penalty[drug]
                for drug in current_drugs
            }

            # Among drugs involved in conflicts, find the one to drop
            conflict_drugs = set()
            for ddi in remaining_conflicts:
                conflict_drugs.add(ddi["drug_a"])
                conflict_drugs.add(ddi["drug_b"])

            drug_to_drop = min(
                conflict_drugs,
                key=lambda d: net_score[d],
            )

            # Build the intervention event (for UI display)
            related_ddis = [
                ddi for ddi in remaining_conflicts
                if drug_to_drop in (ddi["drug_a"], ddi["drug_b"])
            ]
            for ddi in related_ddis:
                kept = ddi["drug_b"] if drug_to_drop == ddi["drug_a"] else ddi["drug_a"]
                blocked_events.append({
                    "drug_a": ddi["drug_a"],
                    "drug_b": ddi["drug_b"],
                    "severity": ddi["severity"],
                    "side_effect": ddi["side_effect"],
                    "mechanism": ddi["mechanism"],
                    "frequency": ddi["frequency"],
                    "source": ddi["source"],
                    "action_taken": (
                        f"PID-blocked {drug_to_drop} "
                        f"(confidence {current_drugs[drug_to_drop]:.3f}, "
                        f"net-score {net_score[drug_to_drop]:.3f}) "
                        f"in favour of {kept} "
                        f"(confidence {current_drugs[kept]:.3f})"
                    ),
                    "pid_iteration": iteration + 1,
                    "pid_error": round(error, 4),
                    "pid_output": round(pid_output, 4),
                })
                break  # One event per dropped drug

            del current_drugs[drug_to_drop]

        return current_drugs, blocked_events
