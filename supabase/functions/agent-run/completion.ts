export function taskOutcome(stepStatuses: string[]): "complete" | "fail" {
  return stepStatuses.includes("succeeded") ? "complete" : "fail";
}
