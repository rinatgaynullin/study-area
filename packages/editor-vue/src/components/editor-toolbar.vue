<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Translate } from '@rich-editor/core';
import RteToolbarButton from './rte-toolbar-button.vue';
import RteDropdown from './rte-dropdown.vue';
import RteIcon from './rte-icon.vue';
import ColorPanel from './color-panel.vue';
import type { ToolbarGroup, ToolbarItemId } from '../toolbar/presets';
import type { ToolbarState } from '../composables/toolbar-state';

const props = withDefaults(
  defineProps<{
    t: Translate;
    state: ToolbarState;
    groups: ToolbarGroup[];
    disabled?: boolean;
    /** Below this container width, collapsible groups move into the ⋯ menu. */
    collapseBelow?: number;
    textSwatches?: string[];
    highlightSwatches?: string[];
  }>(),
  {
    disabled: false,
    collapseBelow: 760,
    textSwatches: () => [
      '#000000', '#424242', '#757575', '#1976d2', '#0288d1', '#00897b',
      '#388e3c', '#f9a825', '#ef6c00', '#d32f2f', '#c2185b', '#7b1fa2',
    ],
    highlightSwatches: () => [
      '#fff59d', '#ffe082', '#ffcc80', '#ffab91', '#f48fb1', '#ce93d8',
      '#b39ddb', '#90caf9', '#80deea', '#a5d6a7', '#e6ee9c', '#eeeeee',
    ],
  },
);

const emit = defineEmits<{ (event: 'command', id: string, payload?: unknown): void }>();

const root = ref<HTMLElement | null>(null);
const narrow = ref(false);
let observer: ResizeObserver | null = null;

onMounted(() => {
  if (!root.value || typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(([entry]) => {
    narrow.value = entry.contentRect.width < props.collapseBelow;
  });
  observer.observe(root.value);
});

onBeforeUnmount(() => observer?.disconnect());

const DROPDOWN_ITEMS: ToolbarItemId[] = [
  'heading', 'align', 'textColor', 'highlight', 'table', 'file',
];

/** Only groups made purely of plain buttons can fold into the overflow menu. */
const collapsibleGroups = computed(() =>
  props.groups.filter(
    (group) => group.collapsible && group.items.every((item) => !DROPDOWN_ITEMS.includes(item)),
  ),
);

const visibleGroups = computed(() =>
  narrow.value
    ? props.groups.filter((group) => !collapsibleGroups.value.includes(group))
    : props.groups,
);

const overflowGroups = computed(() => (narrow.value ? collapsibleGroups.value : []));

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6];
const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;

const TABLE_ACTIONS = [
  'addRowBefore', 'addRowAfter', 'deleteRow',
  'addColumnBefore', 'addColumnAfter', 'deleteColumn',
  'mergeCells', 'splitCell', 'toggleHeaderRow', 'toggleHeaderColumn', 'deleteTable',
] as const;

const ICONS: Partial<Record<ToolbarItemId, string>> = {
  undo: 'undo',
  redo: 'redo',
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strike',
  subscript: 'subscript',
  superscript: 'superscript',
  bulletList: 'bulletList',
  orderedList: 'orderedList',
  blockquote: 'blockquote',
  code: 'code',
  codeBlock: 'codeBlock',
  horizontalRule: 'horizontalRule',
  link: 'link',
  image: 'image',
  audio: 'audio',
  file: 'file',
  formulaMath: 'formulaMath',
  formulaChem: 'formulaChem',
  clearFormat: 'clearFormat',
};

const LABELS: Partial<Record<ToolbarItemId, string>> = {
  undo: 'toolbar_undo',
  redo: 'toolbar_redo',
  bold: 'toolbar_bold',
  italic: 'toolbar_italic',
  underline: 'toolbar_underline',
  strike: 'toolbar_strike',
  subscript: 'toolbar_subscript',
  superscript: 'toolbar_superscript',
  bulletList: 'toolbar_bullet_list',
  orderedList: 'toolbar_ordered_list',
  blockquote: 'toolbar_blockquote',
  code: 'toolbar_code',
  codeBlock: 'toolbar_code_block',
  horizontalRule: 'toolbar_horizontal_rule',
  link: 'toolbar_link',
  image: 'toolbar_image',
  audio: 'toolbar_audio',
  file: 'toolbar_file',
  formulaMath: 'toolbar_formula_math',
  formulaChem: 'toolbar_formula_chem',
  clearFormat: 'toolbar_clear_format',
};

function isActive(item: ToolbarItemId): boolean {
  const map: Partial<Record<ToolbarItemId, boolean>> = {
    bold: props.state.bold,
    italic: props.state.italic,
    underline: props.state.underline,
    strike: props.state.strike,
    subscript: props.state.subscript,
    superscript: props.state.superscript,
    bulletList: props.state.bulletList,
    orderedList: props.state.orderedList,
    blockquote: props.state.blockquote,
    code: props.state.code,
    codeBlock: props.state.codeBlock,
    link: props.state.link,
  };
  return map[item] ?? false;
}

function isDisabled(item: ToolbarItemId): boolean {
  if (props.disabled) return true;
  if (item === 'undo') return !props.state.canUndo;
  if (item === 'redo') return !props.state.canRedo;
  return false;
}

const headingLabel = computed(() =>
  props.state.headingLevel > 0
    ? `H${props.state.headingLevel}`
    : props.t('toolbar_paragraph'),
);

const ALIGN_ICONS = {
  left: 'alignLeft',
  center: 'alignCenter',
  right: 'alignRight',
  justify: 'alignJustify',
} as const;

const ALIGN_LABELS = {
  left: 'toolbar_align_left',
  center: 'toolbar_align_center',
  right: 'toolbar_align_right',
  justify: 'toolbar_align_justify',
} as const;

const alignIcon = computed(() => ALIGN_ICONS[props.state.align]);

function alignIconFor(value: (typeof ALIGNMENTS)[number]): string {
  return ALIGN_ICONS[value];
}

function alignLabelFor(value: (typeof ALIGNMENTS)[number]): string {
  return ALIGN_LABELS[value];
}
</script>

<template>
  <div ref="root" class="rte-toolbar" role="toolbar" :aria-label="t('toolbar_group_formatting')">
    <div v-for="group in visibleGroups" :key="group.id" class="rte-toolbar__group">
      <template v-for="item in group.items" :key="item">
        <!-- Heading picker -->
        <template v-if="item === 'heading'">
          <RteDropdown
            :label="t('toolbar_heading')"
            :active="state.headingLevel > 0"
            :disabled="disabled"
          >
            <template #button>
              <span class="rte-btn__text">{{ headingLabel }}</span>
            </template>
            <template #default="{ close }">
              <button
                type="button"
                class="rte-menu__item"
                :class="{ 'rte-menu__item--active': state.headingLevel === 0 }"
                @click="emit('command', 'heading', 0); close()"
              >
                {{ t('toolbar_paragraph') }}
              </button>
              <button
                v-for="level in HEADING_LEVELS"
                :key="level"
                type="button"
                class="rte-menu__item"
                :class="{ 'rte-menu__item--active': state.headingLevel === level }"
                @click="emit('command', 'heading', level); close()"
              >
                <span :class="`rte-menu__heading rte-menu__heading--${level}`">
                  {{ t('toolbar_heading_level', { level }) }}
                </span>
              </button>
            </template>
          </RteDropdown>
        </template>

        <!-- Alignment -->
        <template v-else-if="item === 'align'">
          <RteDropdown
            v-slot="{ close }"
            :icon="alignIcon"
            :label="t('toolbar_align')"
            :disabled="disabled"
          >
            <button
              v-for="value in ALIGNMENTS"
              :key="value"
              type="button"
              class="rte-menu__item"
              :class="{ 'rte-menu__item--active': state.align === value }"
              @click="emit('command', 'align', value); close()"
            >
              <RteIcon :name="alignIconFor(value)" :size="16" />
              {{ t(alignLabelFor(value)) }}
            </button>
          </RteDropdown>
        </template>

        <!-- Text color -->
        <template v-else-if="item === 'textColor'">
          <RteDropdown
            v-slot="{ close }"
            icon="textColor"
            :label="t('toolbar_text_color')"
            :active="!!state.textColor"
            :disabled="disabled"
          >
            <ColorPanel
              :t="t"
              :value="state.textColor"
              :swatches="textSwatches"
              @select="emit('command', 'textColor', $event); close()"
              @reset="emit('command', 'textColor', null); close()"
            />
          </RteDropdown>
        </template>

        <!-- Highlight color -->
        <template v-else-if="item === 'highlight'">
          <RteDropdown
            v-slot="{ close }"
            icon="highlight"
            :label="t('toolbar_highlight')"
            :active="state.highlight"
            :disabled="disabled"
          >
            <ColorPanel
              :t="t"
              :value="state.highlightColor"
              :swatches="highlightSwatches"
              @select="emit('command', 'highlight', $event); close()"
              @reset="emit('command', 'highlight', null); close()"
            />
          </RteDropdown>
        </template>

        <!-- Table: insert plus in-table operations -->
        <template v-else-if="item === 'table'">
          <RteDropdown
            v-slot="{ close }"
            icon="table"
            :label="t('toolbar_table')"
            :active="state.inTable"
            :disabled="disabled"
          >
            <button
              type="button"
              class="rte-menu__item"
              @click="emit('command', 'table:insert'); close()"
            >
              {{ t('table_insert') }}
            </button>
            <div class="rte-menu__separator" />
            <button
              v-for="action in TABLE_ACTIONS"
              :key="action"
              type="button"
              class="rte-menu__item"
              :disabled="!state.inTable"
              @click="emit('command', `table:${action}`); close()"
            >
              {{ t(`table.${action}`) }}
            </button>
          </RteDropdown>
        </template>

        <!-- Text files: attach as a chip, or paste the contents in as text -->
        <template v-else-if="item === 'file'">
          <RteDropdown
            v-slot="{ close }"
            icon="file"
            :label="t('toolbar_file')"
            :disabled="disabled"
          >
            <button
              type="button"
              class="rte-menu__item"
              @click="emit('command', 'file:attach'); close()"
            >
              {{ t('file_attach') }}
            </button>
            <button
              type="button"
              class="rte-menu__item"
              @click="emit('command', 'file:insert'); close()"
            >
              {{ t('file_insert_content') }}
            </button>
          </RteDropdown>
        </template>

        <!-- Plain buttons -->
        <template v-else>
          <RteToolbarButton
            :icon="ICONS[item]"
            :label="t(LABELS[item] ?? item)"
            :active="isActive(item)"
            :disabled="isDisabled(item)"
            @click="emit('command', item)"
          />
        </template>
      </template>
    </div>

    <template v-if="overflowGroups.length > 0">
      <RteDropdown v-slot="{ close }" icon="more" :label="t('toolbar_more')" :disabled="disabled">
        <template v-for="group in overflowGroups" :key="group.id">
          <button
            v-for="item in group.items"
            :key="item"
            type="button"
            class="rte-menu__item"
            :class="{ 'rte-menu__item--active': isActive(item) }"
            :disabled="isDisabled(item)"
            @click="emit('command', item); close()"
          >
            <RteIcon v-if="ICONS[item]" :name="ICONS[item]!" :size="16" />
            {{ t(LABELS[item] ?? item) }}
          </button>
        </template>
      </RteDropdown>
    </template>
  </div>
</template>
