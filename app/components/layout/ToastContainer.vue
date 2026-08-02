<script setup>
/* ========================================================================== *
 * ToastContainer — 全局反馈弹窗渲染层
 *
 * 职责: 读取 useToast 的响应式状态, 在视口顶部中央堆叠展示
 *       样式自洽, 不依赖 tailwind 配置, 可在任何页面工作
 *
 * 结构: Teleport → body, fixed top-center, 垂直堆叠
 * ========================================================================== */

const { toasts, dismiss } = useToast()

function iconPath(type) {
  if (type === 'success') return 'M5 12l5 5L20 7'
  if (type === 'error')   return 'M6 6l12 12M18 6L6 18'
  if (type === 'warning') return 'M12 8v5M12 17h.01'
  return 'M12 8v5M12 17h.01'
}
</script>

<template>
  <Teleport to="body">
    <div class="app-toast-layer" aria-live="polite" aria-atomic="true">
      <TransitionGroup name="app-toast" tag="div" class="app-toast-stack">
        <div
          v-for="item in toasts"
          :key="item.id"
          :class="['app-toast', `app-toast-${item.type}`, { 'app-toast-leaving': item.leaving }]"
          role="status"
          @click="dismiss(item.id)"
        >
          <svg class="app-toast-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle
              v-if="item.type === 'warning' || item.type === 'info' || item.type === 'error'"
              cx="12" cy="12" r="9.5"
              stroke="currentColor" stroke-width="1.7"
            />
            <path
              :d="iconPath(item.type)"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span class="app-toast-msg">{{ item.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style>
/* ============================================================
 * 堆叠层 — 固定视口顶部中央, 不阻塞任何其他交互
 * ============================================================ */
.app-toast-layer {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  /* z-90: 全站最高, 任何 Modal / Drawer 都不能挡住反馈 (与 tailwind z 系统对齐, 取代裸 10000) */
  z-index: 90;
  pointer-events: none;
}
.app-toast-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

/* ============================================================
 * 单条 toast — 白底顶部 message, 语义只落在图标颜色上
 * ============================================================ */
.app-toast {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 220px;
  max-width: min(420px, 92vw);
  padding: 10px 16px;
  border: 1px solid rgba(229, 231, 235, 0.9);
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.45;
  color: #111827;
  background: #fff;
  box-shadow: 0 9px 28px 8px rgba(0, 0, 0, 0.05), 0 6px 16px rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  user-select: none;
}
.app-toast-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  color: currentColor;
}
.app-toast-msg { flex: 1 1 auto; word-break: break-word; }

.app-toast-success .app-toast-icon { color: #10b981; }
.app-toast-warning .app-toast-icon { color: #faad14; }
.app-toast-error .app-toast-icon { color: #ff4d4f; }
.app-toast-info .app-toast-icon { color: #1677ff; }

/* ============================================================
 * 进出场动画
 * ============================================================ */
.app-toast-enter-active,
.app-toast-leave-active {
  transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.app-toast-enter-from {
  opacity: 0;
  transform: translateY(-12px) scale(0.97);
}
.app-toast-enter-to {
  opacity: 1;
  transform: translateY(0) scale(1);
}
.app-toast-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
}
.app-toast-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}
.app-toast-leaving {
  opacity: 0;
}
</style>
