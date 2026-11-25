<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'

withDefaults(
  defineProps<{
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    loading?: boolean
  }>(),
  { type: 'button' },
)
</script>

<template>
  <button
    class="ui-async-button"
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <span class="button-content" :class="{ 'button-content-loading': loading }">
      <slot />
    </span>
    <LoaderCircle v-if="loading" class="button-spinner" :size="18" aria-hidden="true" />
  </button>
</template>

<style scoped>
.ui-async-button {
  position: relative;
}

.ui-async-button[aria-busy='true'] {
  cursor: wait;
}

.button-content {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: inherit;
}

.button-content-loading {
  opacity: 0;
}

.button-spinner {
  position: absolute;
  inset: 0;
  margin: auto;
}

@media (prefers-reduced-motion: no-preference) {
  .button-spinner {
    animation: button-spin 700ms linear infinite;
  }
}

@keyframes button-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
