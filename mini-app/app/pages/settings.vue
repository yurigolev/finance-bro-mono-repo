<script setup lang="ts">
import {
  Archive,
  ArrowLeft,
  BookOpen,
  Clock,
  Layers,
  Plus,
  RotateCcw,
  Search,
  Tag,
  Trash2,
  X,
} from '@lucide/vue'
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  useToastManager,
} from 'reka-ui'
import type {
  OperationKind,
  Settings,
  SettingsCategory,
  SettingsMutation,
  SettingsRule,
  SettingsWordGroup,
} from '#shared/types/settings'

defineOptions({ name: 'SettingsPage' })

type Section = 'timeZone' | 'categories' | 'rules' | 'dictionary'
type View =
  | { section: Section }
  | { section: 'category'; category?: SettingsCategory }
  | { section: 'group'; group: SettingsWordGroup }
  | { section: 'word'; group: SettingsWordGroup; word: string }
  | { section: 'confirm'; title: string; message: string; label: string; change: SettingsMutation }

const sections = {
  timeZone: { title: 'Часовой пояс', icon: Clock },
  categories: { title: 'Личные категории', icon: Tag, detail: 'Расходы и доходы' },
  rules: { title: 'Запомненные слова', icon: BookOpen, detail: 'Ваши правила для фраз' },
  dictionary: { title: 'Встроенные слова', icon: Layers, detail: 'Стандартный словарь бота' },
}
const kindNames = { expense: 'Расходы', income: 'Доходы' }
const kinds = [
  { value: 'expense', label: kindNames.expense },
  { value: 'income', label: kindNames.income },
] as const
const zones = ['UTC', ...(Intl.supportedValuesOf?.('timeZone') ?? [])]
const settings = shallowRef<Settings>()
const loading = ref(false)
const requiresTelegram = ref(false)
const loadError = ref(false)
const pendingSave = shallowRef<SettingsMutation>()
const saving = computed(() => !!pendingSave.value)
const saveError = ref('')
const messages = useToastManager()
const settingsSavedMessageId = 'settings-saved'
const stack = shallowRef<View[]>([])
const activeView = computed(() => stack.value.at(-1))
// Keep the last rendered screen available to Reka UI during the exit animation.
const sheet = computed<{ stack: View[]; settings: Settings } | undefined>((previous) =>
  activeView.value && settings.value ? { stack: stack.value, settings: settings.value } : previous,
)
const view = computed(() => sheet.value?.stack.at(-1))
const categoryOptions = computed(() => {
  const current = view.value
  if (current?.section !== 'group' && current?.section !== 'word') return []

  const categories = sheet.value?.settings.categories[current.group.kind] ?? []
  return categories
    .filter(({ key }) => current.section === 'word' || key === null)
    .map(({ id, name }) => ({ value: id, label: name }))
})
const kind = ref<OperationKind>('expense')
const name = ref('')
const timeZone = ref('')
const target = ref('')
const query = ref('')
let opener: HTMLElement | undefined
const sheetHeading = useTemplateRef<HTMLElement>('sheet-heading')
const sheetScroll = useTemplateRef<HTMLElement>('sheet-scroll')
let heightAnimation: Animation | undefined

watch(stack, async (current, previous) => {
  const scroll = sheetScroll.value
  const panel = scroll?.parentElement
  if (!current.length || !previous.length || !scroll || !panel) return

  const from = panel.getBoundingClientRect().height
  heightAnimation?.cancel()
  await nextTick()
  if (stack.value !== current || sheetScroll.value !== scroll) return

  sheetHeading.value?.focus({ preventScroll: true })
  scroll.scrollTop = 0
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const motion = { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
  const to = panel.getBoundingClientRect().height
  if (Math.abs(to - from) >= 1) {
    heightAnimation = panel.animate([{ height: `${from}px` }, { height: `${to}px` }], motion)
  }

  const offset = current.length > previous.length ? 12 : -12
  scroll.firstElementChild?.animate(
    [
      { opacity: 0, transform: `translateX(${offset}px)` },
      { opacity: 1, transform: 'none' },
    ],
    motion,
  )
})

const initData = useTelegramWebApp((background) => {
  if (!background || (!activeView.value && !saving.value)) void load()
})

useHead({ title: 'Настройки' })
onDeactivated(() => (stack.value = []))

async function request(change?: SettingsMutation) {
  if (!initData) return
  return fetch('/api/settings', {
    method: change ? 'PATCH' : 'GET',
    headers: {
      'X-Telegram-Init-Data': initData,
      ...(change && { 'Content-Type': 'application/json' }),
    },
    body: change ? JSON.stringify(change) : undefined,
    cache: 'no-store',
    redirect: 'error',
  })
}

async function load() {
  if (loading.value) return true
  if (!initData) {
    requiresTelegram.value = true
    return false
  }
  loading.value = true
  try {
    const response = await request()
    requiresTelegram.value = response?.status === 401
    if (requiresTelegram.value) settings.value = undefined
    if (!response?.ok) throw new Error()
    settings.value = await response.json()
    loadError.value = false
    return true
  } catch {
    loadError.value = true
    return false
  } finally {
    loading.value = false
  }
}

function open(section: Section, event: MouseEvent) {
  if (loading.value || saving.value) return
  opener = event.currentTarget as HTMLElement
  timeZone.value = settings.value?.timeZone ?? ''
  kind.value = 'expense'
  query.value = ''
  go({ section })
}

function go(next: View) {
  saveError.value = ''
  if (next.section === 'category') name.value = next.category?.name ?? ''
  target.value = ''
  stack.value = [...stack.value, next]
}

function back() {
  saveError.value = ''
  target.value = ''
  stack.value = stack.value.slice(0, -1)
}

function restoreFocus(event: Event) {
  event.preventDefault()
  heightAnimation?.cancel()
  heightAnimation = undefined
  opener?.focus()
}

async function save(change: SettingsMutation) {
  if (saving.value || loading.value || loadError.value) return
  pendingSave.value = change
  saveError.value = ''
  messages.close(settingsSavedMessageId)
  try {
    const response = await request(change)
    if (response?.status === 401) {
      requiresTelegram.value = true
      settings.value = undefined
      stack.value = []
      return
    }
    if (!response?.ok) {
      const result = await response?.json()
      if (result?.error === 'duplicate') {
        saveError.value = 'Категория с таким названием уже есть.'
      } else if (result?.error === 'invalid') {
        saveError.value =
          change.action === 'time-zone'
            ? 'Укажите часовой пояс IANA, например Asia/Yekaterinburg.'
            : 'Введите название от 1 до 60 символов.'
      } else if (result?.error === 'unavailable') {
        if (!(await load())) stack.value = []
        saveError.value = 'Настройка уже изменилась. Вернитесь к списку и попробуйте снова.'
      } else {
        throw new Error()
      }
      return
    }

    const refreshed = await load()
    if (!refreshed || change.action === 'time-zone') stack.value = []
    else if (activeView.value?.section === 'confirm') {
      back()
      if (change.action === 'archive-category') back()
    } else if (change.action === 'add-category' || change.action === 'rename-category') back()
    target.value = ''
    messages.add({
      id: settingsSavedMessageId,
      status: 'success',
      title: 'Изменения сохранены.',
      description: refreshed ? undefined : 'Не удалось обновить список.',
    })
  } catch {
    saveError.value = 'Не удалось сохранить. Попробуйте снова.'
  } finally {
    pendingSave.value = undefined
  }
}

function saveCategory(category?: SettingsCategory) {
  return save(
    category
      ? { action: 'rename-category', id: category.id, name: name.value }
      : { action: 'add-category', kind: kind.value, name: name.value },
  )
}

function confirmArchive(category: SettingsCategory) {
  go({
    section: 'confirm',
    title: 'Архивировать категорию?',
    message: `«${category.name}» исчезнет из списка активных категорий. Записанные операции сохранятся.`,
    label: 'Архивировать',
    change: { action: 'archive-category', id: category.id },
  })
}

function confirmDelete(rule: SettingsRule) {
  go({
    section: 'confirm',
    title: 'Удалить правило?',
    message: `Бот перестанет использовать ваше правило для «${rule.expression}».`,
    label: 'Удалить правило',
    change: { action: 'delete-rule', id: rule.id, categoryId: rule.categoryId },
  })
}

function normalize(text: string) {
  return text.trim().toLowerCase().replaceAll('ё', 'е').replace(/\s+/gu, ' ')
}

const foundWords = computed(() => {
  const search = normalize(query.value)
  if (!search) return []
  return (sheet.value?.settings.groups ?? []).flatMap((group) =>
    group.words.filter((word) => normalize(word).includes(search)).map((word) => ({ group, word })),
  )
})

function groupTarget(group: SettingsWordGroup) {
  return sheet.value?.settings.categories[group.kind].find((category) => category.key === group.key)
}

function ruleLabel(rule: SettingsRule) {
  return rule.categoryId === null
    ? 'Отключено'
    : `${rule.categoryName ?? 'Категория недоступна'}${rule.archivedAt ? ' (архив)' : ''}`
}

const wordRule = computed(() => {
  const wordView = view.value
  if (wordView?.section !== 'word') return
  const word = normalize(wordView.word)
  const rules = sheet.value?.settings.rules.filter(
    (rule) => rule.kind === wordView.group.kind && normalize(rule.expression) === word,
  )
  return rules?.find((rule) => rule.expression === word) ?? rules?.[0]
})

const listView = computed(() => {
  const section = view.value?.section
  return (
    section === 'categories' ||
    section === 'rules' ||
    section === 'dictionary' ||
    section === 'group'
  )
})

const title = computed(() => {
  const current = view.value
  if (!current) return ''
  switch (current.section) {
    case 'confirm':
      return current.title
    case 'category':
      return current.category ? 'Изменить категорию' : 'Добавить категорию'
    case 'group':
      return current.group.name
    case 'word':
      return `«${current.word}»`
    default:
      return sections[current.section].title
  }
})
</script>

<template>
  <main class="analytics settings">
    <h1>Настройки</h1>

    <p v-if="requiresTelegram" class="message">Откройте мини-приложение из Telegram.</p>
    <template v-else-if="loadError">
      <p class="message" role="status">Не удалось загрузить настройки.</p>
      <UiAsyncButton class="retry" :loading="loading" @click="load">Повторить</UiAsyncButton>
    </template>
    <div v-else-if="!settings" class="settings-loading" aria-busy="true" aria-label="Настройки">
      <UiSkeleton class="settings-loading-profile" />
      <UiSkeleton class="settings-loading-categories" />
    </div>
    <template v-else>
      <section class="settings-section" aria-labelledby="settings-profile">
        <h2 id="settings-profile">Профиль</h2>
        <UiMenuList>
          <UiMenuRow
            :label="sections.timeZone.title"
            :icon="sections.timeZone.icon"
            :value="settings.timeZone ?? 'UTC'"
            @click="open('timeZone', $event)"
          />
        </UiMenuList>
      </section>

      <section class="settings-section" aria-labelledby="settings-categorisation">
        <h2 id="settings-categorisation">Категоризация</h2>
        <UiMenuList>
          <UiMenuRow
            v-for="section in ['categories', 'rules', 'dictionary'] as const"
            :key="section"
            :label="sections[section].title"
            :detail="sections[section].detail"
            :icon="sections[section].icon"
            @click="open(section, $event)"
          />
        </UiMenuList>
      </section>
    </template>

    <DialogRoot :open="!!activeView" @update:open="(open) => !open && !saving && (stack = [])">
      <DialogPortal>
        <DialogOverlay class="bottom-sheet-overlay" />
        <DialogContent
          v-if="view && sheet"
          class="bottom-sheet settings-sheet"
          :inert="!activeView"
          :class="{ 'settings-sheet-list': listView }"
          @close-auto-focus="restoreFocus"
        >
          <div class="sheet-handle" aria-hidden="true" />
          <header class="sheet-header">
            <button
              v-if="sheet.stack.length > 1"
              type="button"
              aria-label="Назад"
              :disabled="saving"
              @click="back"
            >
              <ArrowLeft :size="21" aria-hidden="true" />
            </button>
            <DialogTitle as-child>
              <h2 ref="sheet-heading" class="sheet-title" tabindex="-1">{{ title }}</h2>
            </DialogTitle>
            <button type="button" aria-label="Закрыть" :disabled="saving" @click="stack = []">
              <X :size="21" aria-hidden="true" />
            </button>
          </header>

          <DialogDescription class="sr-only">Настройки FinanceBro</DialogDescription>
          <div ref="sheet-scroll" class="sheet-scroll">
            <fieldset :key="view.section" class="sheet-body" :disabled="saving || loading">
              <form
                v-if="view.section === 'timeZone'"
                @submit.prevent="save({ action: 'time-zone', timeZone: timeZone.trim() })"
              >
                <div class="sheet-summary">
                  <Clock class="summary-icon" aria-hidden="true" />
                  <dl>
                    <dt>Текущий часовой пояс</dt>
                    <dd>{{ sheet.settings.timeZone ?? 'UTC' }}</dd>
                  </dl>
                </div>
                <label for="settings-time-zone">Новый часовой пояс</label>
                <UiCombobox
                  id="settings-time-zone"
                  v-model="timeZone"
                  :options="zones"
                  placeholder="Asia/Yekaterinburg"
                  :max-length="128"
                  :disabled="saving || loading"
                  required
                />
                <UiAsyncButton
                  class="sheet-primary"
                  type="submit"
                  :disabled="!timeZone.trim()"
                  :loading="pendingSave?.action === 'time-zone' && pendingSave.timeZone !== null"
                >
                  Сохранить
                </UiAsyncButton>
                <UiAsyncButton
                  v-if="sheet.settings.timeZone !== null"
                  class="sheet-secondary"
                  :loading="pendingSave?.action === 'time-zone' && pendingSave.timeZone === null"
                  @click="save({ action: 'time-zone', timeZone: null })"
                >
                  <RotateCcw :size="17" aria-hidden="true" /> Сбросить на UTC
                </UiAsyncButton>
              </form>

              <template v-else-if="view.section === 'categories'">
                <UiSegmentedRadioGroup
                  v-model="kind"
                  :options="kinds"
                  :disabled="saving || loading"
                  class="sheet-segments"
                  aria-label="Тип операции"
                />
                <p v-if="!sheet.settings.categories[kind].length" class="sheet-empty">
                  Нет активных категорий.
                </p>
                <UiMenuList v-else>
                  <UiMenuRow
                    v-for="category in sheet.settings.categories[kind]"
                    :key="category.id"
                    :label="category.name"
                    @click="go({ section: 'category', category })"
                  />
                </UiMenuList>
              </template>

              <form
                v-else-if="view.section === 'category'"
                @submit.prevent="saveCategory(view.category)"
              >
                <div class="sheet-summary">
                  <Tag class="summary-icon" aria-hidden="true" />
                  <dl>
                    <dt>Тип операции</dt>
                    <dd>{{ kindNames[kind] }}</dd>
                  </dl>
                </div>
                <label for="settings-category-name">Название категории</label>
                <input id="settings-category-name" v-model="name" maxlength="120" required />
                <UiAsyncButton
                  class="sheet-primary"
                  type="submit"
                  :disabled="!name.trim() || [...name.trim()].length > 60"
                  :loading="
                    pendingSave?.action === 'add-category' ||
                    pendingSave?.action === 'rename-category'
                  "
                >
                  Сохранить
                </UiAsyncButton>
                <button
                  v-if="view.category"
                  class="sheet-secondary destructive"
                  type="button"
                  @click="confirmArchive(view.category)"
                >
                  <Archive :size="17" aria-hidden="true" /> Архивировать
                </button>
              </form>

              <template v-else-if="view.section === 'rules'">
                <div v-if="!sheet.settings.rules.length" class="sheet-empty">
                  <BookOpen :size="25" aria-hidden="true" />
                  <strong>Пока нет запомненных слов</strong>
                  <p>Правила появятся здесь, когда вы запомните категорию операции в боте.</p>
                </div>
                <UiMenuList v-else class="rules-list">
                  <UiMenuRow
                    v-for="rule in sheet.settings.rules"
                    :key="rule.id"
                    as="div"
                    :label="rule.expression"
                    :detail="`${ruleLabel(rule)} · ${kindNames[rule.kind]}`"
                  >
                    <template #action>
                      <button
                        class="row-action destructive"
                        type="button"
                        :aria-label="'Удалить правило «' + rule.expression + '»'"
                        @click="confirmDelete(rule)"
                      >
                        <Trash2 :size="18" aria-hidden="true" />
                      </button>
                    </template>
                  </UiMenuRow>
                </UiMenuList>
              </template>

              <template v-else-if="view.section === 'dictionary'">
                <label for="settings-word-search" class="sr-only">Поиск слова или фразы</label>
                <div class="sheet-search">
                  <Search :size="19" aria-hidden="true" />
                  <input
                    id="settings-word-search"
                    v-model="query"
                    type="search"
                    placeholder="Найти слово или фразу"
                  />
                </div>
                <template v-if="query.trim()">
                  <p v-if="!foundWords.length" class="sheet-empty">Совпадений нет.</p>
                  <UiMenuList v-else>
                    <UiMenuRow
                      v-for="{ group, word } in foundWords"
                      :key="group.kind + ':' + group.key + ':' + word"
                      :label="word"
                      :detail="`${group.name} · ${kindNames[group.kind]}`"
                      @click="go({ section: 'word', group, word })"
                    />
                  </UiMenuList>
                </template>
                <template v-else>
                  <section
                    v-for="(label, value) in kindNames"
                    :key="value"
                    class="dictionary-group"
                  >
                    <h3>{{ label }}</h3>
                    <UiMenuList>
                      <UiMenuRow
                        v-for="group in sheet.settings.groups.filter(
                          (group) => group.kind === value,
                        )"
                        :key="group.key"
                        :label="group.name"
                        @click="go({ section: 'group', group })"
                      />
                    </UiMenuList>
                  </section>
                </template>
              </template>

              <template v-else-if="view.section === 'group'">
                <div class="sheet-summary">
                  <Tag class="summary-icon" aria-hidden="true" />
                  <dl>
                    <dt>Категория по умолчанию</dt>
                    <dd>{{ groupTarget(view.group)?.name ?? 'Не подключена' }}</dd>
                  </dl>
                </div>
                <form
                  v-if="!groupTarget(view.group)"
                  class="sheet-bind-form"
                  @submit.prevent="
                    save({
                      action: 'bind-group',
                      kind: view.group.kind,
                      key: view.group.key,
                      categoryId: target,
                    })
                  "
                >
                  <label for="settings-bind-target">Подключить категорию</label>
                  <UiSelect
                    id="settings-bind-target"
                    v-model="target"
                    :options="categoryOptions"
                    :disabled="saving || loading"
                    placeholder="Выберите свободную категорию"
                  />
                  <p v-if="!categoryOptions.length" class="message">
                    Добавьте личную категорию, чтобы подключить её к этим словам.
                  </p>
                  <UiAsyncButton
                    class="sheet-primary"
                    type="submit"
                    :disabled="!target"
                    :loading="pendingSave?.action === 'bind-group'"
                  >
                    Подключить
                  </UiAsyncButton>
                </form>
                <UiMenuList>
                  <UiMenuRow
                    v-for="word in view.group.words"
                    :key="word"
                    :label="word"
                    @click="go({ section: 'word', group: view.group, word })"
                  />
                </UiMenuList>
              </template>

              <template v-else-if="view.section === 'word'">
                <dl class="sheet-mapping">
                  <div>
                    <dt>По умолчанию</dt>
                    <dd>{{ groupTarget(view.group)?.name ?? 'Категория не подключена' }}</dd>
                  </div>
                  <div v-if="wordRule">
                    <dt>Ваше правило</dt>
                    <dd>{{ ruleLabel(wordRule) }}</dd>
                  </div>
                </dl>
                <form
                  @submit.prevent="
                    save({ action: 'change-word', kind: view.group.kind, word: view.word, target })
                  "
                >
                  <label for="settings-word-target">Сменить категорию</label>
                  <UiSelect
                    id="settings-word-target"
                    v-model="target"
                    :options="categoryOptions"
                    :disabled="saving || loading"
                    placeholder="Выберите категорию"
                  />
                  <UiAsyncButton
                    class="sheet-primary"
                    type="submit"
                    :disabled="!target"
                    :loading="
                      pendingSave?.action === 'change-word' && pendingSave.target === target
                    "
                  >
                    Сохранить
                  </UiAsyncButton>
                </form>
                <UiAsyncButton
                  v-if="wordRule?.categoryId !== null"
                  class="sheet-secondary"
                  :loading="pendingSave?.action === 'change-word' && pendingSave.target === null"
                  @click="
                    save({
                      action: 'change-word',
                      kind: view.group.kind,
                      word: view.word,
                      target: null,
                    })
                  "
                >
                  Отключить слово
                </UiAsyncButton>
                <UiAsyncButton
                  v-if="wordRule"
                  class="sheet-secondary"
                  :loading="pendingSave?.action === 'change-word' && pendingSave.target === 'reset'"
                  @click="
                    save({
                      action: 'change-word',
                      kind: view.group.kind,
                      word: view.word,
                      target: 'reset',
                    })
                  "
                >
                  Вернуть стандартную категорию
                </UiAsyncButton>
              </template>

              <template v-else-if="view.section === 'confirm'">
                <p class="confirm-copy">{{ view.message }}</p>
                <div class="confirm-actions">
                  <button class="sheet-secondary" type="button" @click="back">Отмена</button>
                  <UiAsyncButton
                    class="sheet-primary destructive"
                    :loading="saving"
                    @click="save(view.change)"
                  >
                    {{ view.label }}
                  </UiAsyncButton>
                </div>
              </template>
            </fieldset>
          </div>
          <footer v-if="view.section === 'categories'" class="sheet-footer">
            <button class="sheet-primary" type="button" @click="go({ section: 'category' })">
              <Plus :size="19" aria-hidden="true" /> Добавить категорию
            </button>
          </footer>
          <p v-if="saveError" class="message destructive" role="alert">{{ saveError }}</p>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </main>
</template>

<style scoped>
.settings h1 {
  margin: 19px 0 20px;
  font-size: 32px;
  font-weight: 760;
  line-height: 1.07;
  letter-spacing: -0.045em;
}

.settings-section + .settings-section {
  margin-top: 24px;
}

.settings-loading {
  display: grid;
  gap: 24px;
}

.settings-loading-profile {
  height: 52px;
}

.settings-loading-categories {
  height: 156px;
}

.settings-section h2 {
  margin: 0 0 8px 16px;
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.2;
}

.settings-sheet {
  --sheet-surface: color-mix(in srgb, var(--background) 55%, var(--control));
  max-height: calc(
    100dvh - 12px -
      max(
        env(safe-area-inset-top, 0px),
        var(--tg-safe-area-inset-top, 0px) + var(--tg-content-safe-area-inset-top, 0px)
      )
  );
  padding: 12px max(16px, env(safe-area-inset-right, 0px))
    calc(20px + var(--analytics-bottom-inset)) max(16px, env(safe-area-inset-left, 0px));
  overflow: hidden;
  background: var(--sheet-surface);
}

.settings-sheet-list {
  height: min(650px, 86dvh);
}

.sheet-handle {
  flex: none;
  width: 44px;
  height: 5px;
  margin: 0 auto 9px;
  border-radius: var(--radius-pill);
  background: var(--line);
}

.sheet-header {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.sheet-title {
  flex: 1;
  font-size: clamp(20px, 5.8vw, 24px);
  overflow-wrap: anywhere;
  outline: none;
}

.sheet-header button,
.row-action {
  display: grid;
  flex: none;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: var(--radius-pill);
  background: var(--control);
  color: var(--muted);
}

.sheet-scroll {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: var(--line) transparent;
}

.sheet-body {
  min-width: 0;
  margin: 0;
  padding: 0 0 4px;
  border: 0;
}

.sheet-summary,
.sheet-mapping,
.sheet-empty {
  padding: 14px;
  border-radius: var(--radius-card);
  background: var(--control);
}

.sheet-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.summary-icon {
  flex: none;
  width: 38px;
  height: 38px;
  padding: 9px;
  border-radius: 14px;
  background: var(--accent-surface);
  color: var(--accent);
}

.sheet-summary dt,
.sheet-mapping dt {
  color: var(--muted);
  font-size: 13px;
}

.sheet-summary dd,
.sheet-mapping dd {
  font-weight: 700;
  overflow-wrap: anywhere;
}

.sheet-mapping {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
}

.sheet-mapping > div + div {
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.sheet-segments {
  margin-bottom: 10px;
}

.sheet-body label:not(.sr-only) {
  display: block;
  margin-block: 12px 6px;
  color: var(--muted);
  font-size: 14px;
  font-weight: 650;
}

.sheet-body input {
  display: block;
  width: 100%;
  min-height: 48px;
  padding: 9px 13px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: var(--control);
  color: var(--text);
  font: inherit;
}

.sheet-body input::placeholder {
  color: var(--muted);
}

.sheet-body input:focus {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.sheet-search {
  position: sticky;
  z-index: 2;
  inset-block-start: 0;
  padding-bottom: 8px;
  background: var(--sheet-surface);
}

.dictionary-group h3 {
  margin: 12px 16px 8px;
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

.dictionary-group + .dictionary-group {
  margin-top: 24px;
}

.sheet-bind-form {
  margin-bottom: 12px;
}

.sheet-search svg {
  position: absolute;
  inset-block-start: 24px;
  inset-inline-start: 13px;
  z-index: 1;
  transform: translateY(-50%);
  color: var(--muted);
  pointer-events: none;
}

.sheet-search input {
  padding-inline-start: 41px;
}

.rules-list {
  --menu-row-height: 64px;
}

.sheet-empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 24px 16px;
  color: var(--muted);
  text-align: center;
  font-size: 14px;
}

.sheet-empty svg {
  color: var(--accent);
}

.sheet-empty strong {
  color: var(--text);
  font-size: 16px;
}

.sheet-footer {
  flex: none;
  padding-top: 4px;
  border-top: 1px solid var(--line);
}

.sheet-primary,
.sheet-secondary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 46px;
  margin-top: 9px;
  padding-inline: 12px;
  border-radius: var(--radius-pill);
  color: var(--accent);
  font-weight: 650;
}

.sheet-primary {
  background: var(--accent-surface);
}

.sheet-primary:disabled:not([aria-busy='true']) {
  background: var(--control);
  color: var(--muted);
}

.sheet-secondary:not(.destructive) {
  background: var(--control);
}

.confirm-copy {
  padding: 12px 0 6px;
  color: var(--muted);
}

.confirm-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.destructive {
  color: var(--summary-deficit);
}

.sheet-primary.destructive {
  background: var(--summary-deficit-surface);
}
</style>
