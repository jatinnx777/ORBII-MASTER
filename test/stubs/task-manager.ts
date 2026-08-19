// expo-task-manager registers a background task at module load. Under test we
// only want the pure exports from that module, so the registration is a no-op.
export function defineTask(): void {}
export async function isTaskRegisteredAsync(): Promise<boolean> {
  return false;
}
export default { defineTask, isTaskRegisteredAsync };
