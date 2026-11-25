<script setup lang="ts" generic="Value extends string">
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui'

const model = defineModel<Value>({ required: true })

defineProps<{
  options: readonly { value: Value; label: string }[]
  disabled?: boolean
  pending?: Value
}>()
</script>

<template>
  <RadioGroupRoot
    v-model="model"
    class="period-control"
    orientation="horizontal"
    :disabled="disabled"
  >
    <RadioGroupItem v-for="option in options" :key="option.value" :value="option.value" as-child>
      <UiAsyncButton class="period-option" :disabled="disabled" :loading="pending === option.value">
        {{ option.label }}
      </UiAsyncButton>
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
