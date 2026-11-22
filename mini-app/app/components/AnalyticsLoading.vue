<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<template>
  <div>
    <p class="sr-only" role="status">{{ label }}</p>
    <div aria-hidden="true">
      <slot />
    </div>
  </div>
</template>
