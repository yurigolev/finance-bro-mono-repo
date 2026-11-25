export function usePendingAction<Action extends string>() {
  const pending = shallowRef<Action>()

  async function run(action: Action, task: () => Promise<void>) {
    if (pending.value) return
    pending.value = action
    try {
      await task()
    } finally {
      pending.value = undefined
    }
  }

  return { pending, run }
}
