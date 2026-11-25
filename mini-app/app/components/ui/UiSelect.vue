<script setup lang="ts">
import { Check, ChevronDown } from '@lucide/vue'
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui'

const model = defineModel<string>({ required: true })

defineProps<{
  id: string
  options: readonly { value: string; label: string }[]
  placeholder: string
  disabled?: boolean
}>()
</script>

<template>
  <SelectRoot v-model="model" :disabled="disabled || !options.length">
    <SelectTrigger :id="id" class="ui-picker-control ui-select-trigger">
      <SelectValue :placeholder="placeholder" />
      <ChevronDown :size="18" aria-hidden="true" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        class="ui-picker-popup"
        position="popper"
        :side-offset="6"
        :collision-padding="12"
      >
        <SelectViewport class="ui-picker-viewport">
          <SelectItem
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            class="ui-picker-option"
          >
            <SelectItemText>{{ option.label }}</SelectItemText>
            <SelectItemIndicator>
              <Check :size="17" aria-hidden="true" />
            </SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
