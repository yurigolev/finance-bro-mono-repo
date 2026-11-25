<script setup lang="ts">
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxViewport,
} from 'reka-ui'

const model = defineModel<string>({ required: true })
const props = defineProps<{
  id: string
  options: readonly string[]
  placeholder?: string
  maxLength?: number
  disabled?: boolean
  required?: boolean
}>()

const matches = computed(() => {
  const query = model.value.trim().toLowerCase()
  return props.options.filter((option) => option.toLowerCase().includes(query))
})
const requestedOpen = ref(false)
const open = computed({
  get: () => requestedOpen.value && matches.value.length > 0,
  set: (value) => (requestedOpen.value = value),
})

function select(value: unknown) {
  if (typeof value === 'string') model.value = value
}
</script>

<template>
  <ComboboxRoot
    v-model:open="open"
    :disabled="disabled"
    :reset-search-term-on-blur="false"
    :reset-search-term-on-select="false"
    ignore-filter
    open-on-click
    @update:model-value="select"
  >
    <ComboboxAnchor>
      <ComboboxInput
        :id="id"
        v-model="model"
        class="ui-picker-control"
        :placeholder="placeholder"
        :maxlength="maxLength"
        :required="required"
        autocapitalize="none"
        spellcheck="false"
      />
    </ComboboxAnchor>
    <ComboboxPortal>
      <ComboboxContent
        class="ui-picker-popup"
        position="popper"
        side="top"
        :side-offset="6"
        :collision-padding="12"
      >
        <ComboboxViewport class="ui-picker-viewport">
          <ComboboxItem
            v-for="option in matches"
            :key="option"
            :value="option"
            class="ui-picker-option"
          >
            {{ option }}
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
