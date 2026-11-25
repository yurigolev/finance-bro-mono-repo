<script setup lang="ts">
import { CircleCheck } from '@lucide/vue'
import {
  ToastDescription,
  ToastPortal,
  ToastRoot,
  ToastTitle,
  ToastViewport,
  useToastManager,
} from 'reka-ui'

const { toasts } = useToastManager()
</script>

<template>
  <ToastPortal>
    <ToastRoot v-for="toast in toasts" :key="toast.id" :toast="toast" class="message-toast">
      <CircleCheck v-if="toast.status === 'success'" class="message-icon" aria-hidden="true" />
      <div>
        <ToastTitle class="message-title" />
        <ToastDescription class="message-description" />
      </div>
    </ToastRoot>
    <ToastViewport label="Уведомления ({hotkey})" class="ui-messages-viewport" />
  </ToastPortal>
</template>

<style>
.ui-messages-viewport {
  --messages-top-offset: calc(
    12px +
      max(
        env(safe-area-inset-top, 0px),
        var(--tg-safe-area-inset-top, 0px) + var(--tg-content-safe-area-inset-top, 0px)
      )
  );

  position: fixed;
  z-index: 10;
  inset-block-start: var(--messages-top-offset);
  inset-inline: 16px;
  display: grid;
  justify-items: center;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  pointer-events: none;
}

.ui-messages-viewport .message-toast {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 100%;
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--control);
  box-shadow: 0 6px 22px color-mix(in srgb, var(--glass-shadow) 24%, transparent);
  overflow-wrap: anywhere;
}

.ui-messages-viewport .message-icon {
  width: 20px;
  height: 20px;
  flex: none;
  color: var(--summary-income);
}

.ui-messages-viewport .message-title {
  font-size: 14px;
  font-weight: 700;
}

.ui-messages-viewport .message-description {
  margin-top: 3px;
  color: var(--muted);
  font-size: 13px;
}

@media (prefers-reduced-motion: no-preference) {
  .ui-messages-viewport .message-toast[data-state='open'] {
    animation: message-enter 280ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .ui-messages-viewport .message-toast[data-state='closed'] {
    animation: message-exit 220ms ease-in both;
  }

  @keyframes message-enter {
    from {
      transform: translateY(calc(-100% - var(--messages-top-offset)));
      opacity: 0;
    }
  }

  @keyframes message-exit {
    to {
      transform: translateY(calc(-100% - var(--messages-top-offset)));
      opacity: 0;
    }
  }
}
</style>
