<script setup lang="ts">
import { Plus, X } from '@lucide/vue'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from 'reka-ui'
import type { OperationKind, Settings } from '#shared/types/settings'

const props = defineProps<{ initData: string; today: string; disabled?: boolean }>()
const emit = defineEmits<{ saved: [date: string, kind: OperationKind]; expired: [] }>()

const kinds = [
  { value: 'expense', label: 'Расход' },
  { value: 'income', label: 'Доход' },
] as const
const noCategory = 'none'
const open = ref(false)
const saving = ref(false)
const loadingCategories = ref(false)
const categoryError = ref(false)
const error = ref('')
const categories = shallowRef<Settings['categories']>()
const kind = ref<OperationKind>('expense')
const category = ref(noCategory)
const amount = ref('')
const description = ref('')
const date = ref('')
const heading = useTemplateRef('heading')
let lastSubmission: { draft: string; id: string } | undefined

const categoryOptions = computed(() => [
  { value: noCategory, label: 'Без категории' },
  ...(categories.value?.[kind.value] ?? []).map(({ id, name }) => ({ value: id, label: name })),
])

const kopecks = computed(() => {
  const value = amount.value
    .trim()
    .replace(/[ \u00a0\u202f]/g, '')
    .replace(',', '.')
  if (!/^\d{1,17}(?:\.\d{1,2})?$/.test(value)) return null
  const [rubles = '0', fraction = ''] = value.split('.')
  const result = BigInt(rubles) * 100n + BigInt(fraction.padEnd(2, '0'))
  return result > 0n && result <= 9_223_372_036_854_775_807n ? result.toString() : null
})

const headers = { 'X-Telegram-Init-Data': props.initData }
watch(kind, () => (category.value = noCategory))
onDeactivated(() => (open.value = false))

function setOpen(value: boolean) {
  if (saving.value) return
  if (value) {
    kind.value = 'expense'
    category.value = noCategory
    amount.value = ''
    description.value = ''
    date.value = props.today
    error.value = ''
    void loadCategories()
  }
  open.value = value
}

async function loadCategories() {
  if (loadingCategories.value) return
  loadingCategories.value = true
  categoryError.value = false
  try {
    const response = await fetch('/api/settings', { headers, cache: 'no-store', redirect: 'error' })
    if (response.status === 401) {
      open.value = false
      emit('expired')
      return
    }
    if (!response.ok) throw new Error()
    const settings: Settings = await response.json()
    categories.value = settings.categories
    if (!categoryOptions.value.some((option) => option.value === category.value)) {
      category.value = noCategory
    }
  } catch {
    categoryError.value = true
  } finally {
    loadingCategories.value = false
  }
}

async function save() {
  if (saving.value) return
  if (!kopecks.value) {
    error.value = 'Введите сумму больше нуля, до двух знаков после запятой'
    return
  }

  const draft = {
    kind: kind.value,
    amountKopecks: kopecks.value,
    description: description.value.trim(),
    date: date.value,
    categoryId: category.value === noCategory ? null : category.value,
  }
  if (!draft.description || !draft.date || draft.date > props.today) {
    error.value = 'Проверьте описание и дату операции'
    return
  }

  const serialized = JSON.stringify(draft)
  saving.value = true
  error.value = ''
  try {
    if (lastSubmission?.draft !== serialized) {
      lastSubmission = { draft: serialized, id: crypto.randomUUID() }
    }
    const response = await fetch('/api/transactions', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...draft, requestId: lastSubmission.id }),
      cache: 'no-store',
      redirect: 'error',
    })
    if (response.status === 401) {
      open.value = false
      emit('expired')
      return
    }
    if (response.status === 409) {
      error.value = 'Категория недоступна. Выберите другую.'
      await loadCategories()
      return
    }
    if (response.status === 400) {
      error.value = 'Проверьте сумму, описание и дату операции'
      return
    }
    if (!response.ok) throw new Error()
    lastSubmission = undefined
    open.value = false
    emit('saved', draft.date, draft.kind)
  } catch {
    error.value = 'Не удалось сохранить операцию. Попробуйте ещё раз.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <DialogRoot :open="open" @update:open="setOpen">
    <DialogTrigger class="history-add" :disabled="disabled">
      <Plus :size="20" aria-hidden="true" />
      Добавить
    </DialogTrigger>

    <DialogPortal>
      <DialogOverlay class="bottom-sheet-overlay" />
      <DialogContent class="bottom-sheet entry-sheet" @open-auto-focus.prevent="heading?.focus()">
        <div class="entry-handle" aria-hidden="true" />
        <header class="entry-header">
          <DialogTitle as-child>
            <h2 ref="heading" class="entry-title" tabindex="-1">Новая операция</h2>
          </DialogTitle>
          <DialogDescription class="sr-only">Запишите доход или расход.</DialogDescription>
          <DialogClose class="entry-close" aria-label="Закрыть" :disabled="saving">
            <X :size="22" aria-hidden="true" />
          </DialogClose>
        </header>

        <form class="entry-form" @submit.prevent="save">
          <fieldset :disabled="saving" class="entry-fields">
            <UiSegmentedRadioGroup
              v-model="kind"
              :options="kinds"
              :disabled="saving"
              aria-label="Тип операции"
            />

            <label class="entry-field">
              Сумма, ₽
              <input
                v-model="amount"
                class="ui-picker-control entry-amount"
                inputmode="decimal"
                placeholder="0"
                maxlength="24"
                required
              />
            </label>

            <label class="entry-field">
              Описание
              <input
                v-model="description"
                class="ui-picker-control"
                placeholder="Например, кофе"
                maxlength="200"
                required
              />
            </label>

            <div class="entry-field">
              <label for="history-entry-category">Категория</label>
              <UiSelect
                id="history-entry-category"
                v-model="category"
                :options="categoryOptions"
                :disabled="saving || loadingCategories || categoryError"
                placeholder="Без категории"
              />
              <p v-if="loadingCategories" role="status">Загружаем категории…</p>
              <div v-else-if="categoryError" class="entry-category-error">
                <span role="alert">Не удалось загрузить категории</span>
                <button type="button" @click="loadCategories">Повторить</button>
              </div>
            </div>

            <label class="entry-field">
              Дата
              <input
                v-model="date"
                class="ui-picker-control entry-date"
                type="date"
                min="0001-01-01"
                :max="today"
                required
              />
            </label>
          </fieldset>

          <p v-if="error" class="entry-error" role="alert">{{ error }}</p>
          <UiAsyncButton class="entry-save" type="submit" :loading="saving"
            >Сохранить</UiAsyncButton
          >
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.history-add,
.entry-save {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 42px;
  padding-inline: 14px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--background);
  font-weight: 750;
}

.history-add:disabled {
  opacity: 0.5;
  cursor: default;
}

.entry-sheet {
  max-height: 100dvh;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 12px 16px calc(20px + var(--analytics-bottom-inset));
  background: color-mix(in srgb, var(--background) 55%, var(--control));
}

.entry-handle {
  align-self: center;
  flex: none;
  width: 36px;
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--line);
}

.entry-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-block: 8px 12px;
}

.entry-title {
  font-size: 23px;
}

.entry-close {
  display: grid;
  place-items: center;
  flex: 0 0 44px;
  height: 44px;
  border-radius: var(--radius-pill);
  background: var(--control);
  color: var(--muted);
}

.entry-form,
.entry-fields {
  display: grid;
  gap: 12px;
}

.entry-fields {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.entry-field {
  display: grid;
  gap: 5px;
  min-width: 0;
  color: var(--muted);
  font-size: 14px;
  font-weight: 650;
}

.entry-field .ui-picker-control {
  font-size: 16px;
}

.entry-field .entry-amount {
  font-size: 28px;
  font-weight: 750;
}

.entry-date {
  min-width: 0;
}

.entry-error,
.entry-category-error {
  color: var(--summary-deficit);
  font-size: 14px;
}

.entry-category-error button {
  margin-inline-start: 6px;
  color: var(--accent);
  text-decoration: underline;
}

.entry-save {
  width: 100%;
  min-height: 48px;
  margin-top: 4px;
}
</style>
