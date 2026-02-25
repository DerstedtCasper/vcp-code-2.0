import { createMemo, createSignal, type Accessor, type Setter } from "solid-js"

export interface DirtyState<T> {
  original: Accessor<T>
  current: Accessor<T>
  setCurrent: Setter<T>
  isDirty: Accessor<boolean>
  reset: (value: T) => void
  discard: () => void
}

export function useDirtyState<T>(initial: T): DirtyState<T> {
  const [original, setOriginal] = createSignal<T>(initial)
  const [current, setCurrent] = createSignal<T>(initial)

  const isDirty = createMemo(() => JSON.stringify(original()) !== JSON.stringify(current()))

  const reset = (value: T) => {
    setOriginal(() => value)
    setCurrent(() => value)
  }

  const discard = () => {
    setCurrent(() => original())
  }

  return { original, current, setCurrent, isDirty, reset, discard }
}
