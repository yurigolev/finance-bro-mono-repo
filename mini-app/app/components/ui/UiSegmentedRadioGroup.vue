<script setup lang="ts" generic="Value extends string">
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui'

const model = defineModel<Value>({ required: true })

defineProps<{
  options: readonly { value: Value; label: string }[]
}>()
</script>

<template>
  <RadioGroupRoot v-model="model" class="period-control" orientation="horizontal">
    <RadioGroupItem
      v-for="option in options"
      :key="option.value"
      class="period-option"
      :value="option.value"
    >
      {{ option.label }}
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
