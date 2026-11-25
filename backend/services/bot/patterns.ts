const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const compactUuidPattern = '[A-Za-z0-9_-]{21}[AQgw]'
export const unhyphenatedUuidPattern = /^(.{8})(.{4})(.{4})(.{4})(.{12})$/u
export const missingEditableMessagePattern = /message to edit not found|message can['’]t be edited/u

export const messageQueuedCallbackPattern = /^(?:rp|rs|rm|rv|pick|set|h|he|ho|hp|hs|hd|hc):/u

const budgetMonthPattern = '[1-9]\\d{3}-(?:0[1-9]|1[0-2])'
export const viewBudgetAction = new RegExp(
  `^b:(?:current|view:(${budgetMonthPattern}):(\\d{1,8}))$`,
  'u',
)
export const pickBudgetCategoryAction = new RegExp(
  `^b:pick:(${budgetMonthPattern}):(\\d{1,8})$`,
  'u',
)
export const changeBudgetLimitAction = new RegExp(
  `^b:(scope|edit|off):(${budgetMonthPattern}):(all|${compactUuidPattern}):(\\d{1,8})$`,
  'u',
)
export const budgetPromptIconPattern = /^🎯 /u

export const builtInWordGroupAction = /^bg:([a-z]+)(?::(\d{1,10}))?$/u
export const builtInWordDetailsAction = /^bw:([\w-]{12})$/u
export const pickBuiltInWordCategoryAction = /^(bp|bt):([\w-]+):(\d{1,10})$/u
export const changeBuiltInWordMappingAction = new RegExp(
  `^bm:([\\w-]{12}):(off|reset|${compactUuidPattern})$`,
  'u',
)
export const bindBuiltInWordGroupAction = new RegExp(`^bb:([a-z]+):(${compactUuidPattern})$`, 'u')

const kindPattern = '(expense|income)'
export const categoryRulesPageAction = /^(rules|rules-page):(\d{1,10})$/u
export const deleteCategoryRuleAction = new RegExp(
  `^rd:(${compactUuidPattern}):(${compactUuidPattern}|none):(\\d{1,10})$`,
  'u',
)
export const categoryCatalogAction = new RegExp(
  `^catalog(?:-page)?:${kindPattern}:(\\d{1,10})$`,
  'u',
)
export const categoryDetailsOrRenameAction = new RegExp(
  `^(details|rename):${kindPattern}:(${uuidPattern})$`,
  'u',
)
export const addCategoryAction = new RegExp(`^add:${kindPattern}$`, 'u')
export const archiveCategoryAction = new RegExp(
  `^archive:(?:${kindPattern}:)?(${uuidPattern})$`,
  'u',
)
export const categoryNamePromptPattern = /^(?:🏷 )?Введите (новое )?название категории/u
export const categorySettingsAction =
  /^(?:settings|catalog|catalog-page|rules|rules-page|rd|bw|bg|bp|bm|bt|bb|details|rename|add|archive):/u

export const editOperationDateAction = new RegExp(`^date:edit:(${compactUuidPattern})$`, 'u')
export const dateDraftAction =
  /^date:([A-Za-z0-9_-]{12}):(\d+):(change|input|quick[012]|pick[01]|save|cancel)$/u
export const operationDatePromptPattern = /^(?:📅 )?Введите дату операции/u

const historyDayPattern = '(\\d{8}(?::[0-9a-z]{1,5})?)'
export const viewHistoryAction = new RegExp(`^h:(?:today|${historyDayPattern})$`, 'u')
export const editHistoryAction = new RegExp(`^he:${historyDayPattern}$`, 'u')
export const historyOperationDetailsOrDeletePromptAction = new RegExp(
  `^(ho|hd):${historyDayPattern}:(${compactUuidPattern})$`,
  'u',
)
export const pickHistoryCategoryAction = new RegExp(
  `^hp:${historyDayPattern}:(${compactUuidPattern}):(\\d{1,10})$`,
  'u',
)
export const setHistoryCategoryAction = new RegExp(
  `^hs:${historyDayPattern}:(${compactUuidPattern}):(none|${compactUuidPattern})$`,
  'u',
)
export const removeHistoryOperationAction = new RegExp(
  `^hc:${historyDayPattern}:(${compactUuidPattern})$`,
  'u',
)
export const trailingHighSurrogatePattern = /[\uD800-\uDBFF]$/u

export const chooseOperationKindAction =
  /^choose:(telegram:(?:voice:\d+:)?\d+):(income|expense|cancel)$/u

export const legacyReceiptRemovalAction = new RegExp(`^remove:(${uuidPattern})$`, 'u')
export const removeReceiptOperationAction = new RegExp(`^rv:(${compactUuidPattern})$`, 'u')
export const pickReceiptCategoryAction = new RegExp(
  `^(pick|rp):(${uuidPattern}):(\\d{1,10}|back)$`,
  'u',
)
export const setReceiptCategoryAction = new RegExp(
  `^(set|rs):(${compactUuidPattern}):(none|${compactUuidPattern})$`,
  'u',
)
export const rememberReceiptCategoryAction = new RegExp(
  `^rm:(${compactUuidPattern}):(${compactUuidPattern})$`,
  'u',
)
export const receiptLineBreakPattern = /\s*\r?\n\s*/gu
