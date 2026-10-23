import { theme, type ThemeConfig } from 'antd'

/**
 * Design system: neutral zinc greys, near-black primary actions, blue only as an accent for links.
 * Type: Geist at a tight 12 / 13 / 14 px scale; weights 400 / 500 / 600 only.
 */
export const PALETTE = {
  light: {
    ink: '#18181b',
    text: '#27272a',
    textSecondary: '#71717a',
    textTertiary: '#a1a1aa',
    border: '#e4e4e7',
    borderSubtle: '#efeff1',
    bg: '#ffffff',
    bgSidebar: '#fafafa',
    bgHover: '#f4f4f5',
    bgHeader: '#fafafa',
    selected: '#f5f7ff',
    onInk: '#ffffff',
  },
  dark: {
    ink: '#fafafa',
    text: '#e4e4e7',
    textSecondary: '#a1a1aa',
    textTertiary: '#71717a',
    border: '#2e2e33',
    borderSubtle: '#26262b',
    bg: '#111113',
    bgSidebar: '#0c0c0e',
    bgHover: '#1c1c20',
    bgHeader: '#151518',
    selected: '#17203a',
    onInk: '#09090b',
  },
}

export const ACCENT = '#2563eb'
/** Clay-style bright blue for primary actions, the active tab, counts and selection. */
export const BLUE = '#1a6cf5'
export const BLUE_DARK = '#3b82f6'
export const FONT =
  "'Geist Variable', 'Geist', ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
export const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace"

const softShadowOf = (dark: boolean) => (dark ? '0 1px 2px rgba(0,0,0,.4)' : '0 1px 2px rgba(24,24,27,.06)')
const popShadowOf = (dark: boolean) =>
  dark
    ? '0 0 0 1px #2e2e33, 0 12px 32px rgba(0,0,0,.55)'
    : '0 0 0 1px rgba(24,24,27,.06), 0 4px 8px rgba(24,24,27,.04), 0 16px 32px rgba(24,24,27,.08)'

export function buildTheme(dark: boolean): ThemeConfig {
  const p = dark ? PALETTE.dark : PALETTE.light
  const softShadow = softShadowOf(dark)
  const popShadow = popShadowOf(dark)
  const hoverBorder = dark ? '#3f3f46' : '#d4d4d8'
  const focusRing = dark ? 'rgba(250,250,250,.08)' : 'rgba(24,24,27,.06)'
  const elevated = dark ? '#18181b' : '#ffffff'

  const blue = dark ? BLUE_DARK : BLUE
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: blue,
      colorInfo: ACCENT,
      colorLink: ACCENT,
      colorLinkHover: '#1d4ed8',
      colorSuccess: '#16a34a',
      colorWarning: '#d97706',
      colorError: '#dc2626',
      colorText: p.text,
      colorTextHeading: p.ink,
      colorTextSecondary: p.textSecondary,
      colorTextTertiary: p.textTertiary,
      colorTextQuaternary: p.textTertiary,
      colorTextLightSolid: '#ffffff',
      colorBorder: p.border,
      colorBorderSecondary: p.borderSubtle,
      colorSplit: p.borderSubtle,
      colorBgLayout: p.bg,
      colorBgContainer: p.bg,
      colorBgElevated: elevated,
      colorBgSpotlight: dark ? '#27272a' : '#18181b',
      colorFillSecondary: p.bgHover,
      colorFillTertiary: p.bgHover,
      colorFillQuaternary: p.bgSidebar,
      controlItemBgHover: p.bgHover,
      controlItemBgActive: p.bgHover,
      controlOutline: focusRing,
      borderRadius: 8,
      borderRadiusLG: 12,
      borderRadiusSM: 6,
      borderRadiusXS: 4,
      fontFamily: FONT,
      fontFamilyCode: MONO,
      fontSize: 14,
      fontSizeSM: 12,
      fontSizeLG: 15,
      fontSizeHeading4: 17,
      fontSizeHeading5: 15,
      lineHeight: 1.55,
      controlHeight: 32,
      controlHeightSM: 26,
      controlHeightLG: 38,
      boxShadow: popShadow,
      boxShadowSecondary: popShadow,
      boxShadowTertiary: softShadow,
      motionDurationFast: '0.08s',
      motionDurationMid: '0.14s',
      motionDurationSlow: '0.2s',
      wireframe: false,
    },
    components: {
      Layout: { siderBg: p.bgSidebar, headerBg: p.bg, bodyBg: p.bg },
      Menu: {
        itemBg: 'transparent',
        subMenuItemBg: 'transparent',
        itemBorderRadius: 6,
        itemHeight: 32,
        itemMarginBlock: 1,
        itemMarginInline: 0,
        itemPaddingInline: 10,
        iconSize: 15,
        iconMarginInlineEnd: 10,
        itemColor: p.text,
        itemHoverColor: p.ink,
        itemHoverBg: p.bgHover,
        itemSelectedBg: p.bg,
        itemSelectedColor: p.ink,
        itemActiveBg: p.bgHover,
        fontSize: 14,
        collapsedIconSize: 16,
      },
      Button: {
        fontWeight: 500,
        defaultShadow: softShadow,
        dangerShadow: 'none',
        defaultBorderColor: p.border,
        defaultColor: p.ink,
        defaultHoverBorderColor: hoverBorder,
        defaultHoverColor: p.ink,
        defaultHoverBg: dark ? '#18181b' : '#fafafa',
        defaultActiveBg: p.bgHover,
        defaultActiveBorderColor: hoverBorder,
        defaultActiveColor: p.ink,
        primaryColor: '#ffffff',
        primaryShadow: '0 1px 2px rgba(26,108,245,.25), inset 0 1px 0 rgba(255,255,255,.12)',
        textHoverBg: p.bgHover,
        paddingInline: 12,
        paddingInlineSM: 8,
        contentFontSize: 13.5,
        contentFontSizeSM: 12.5,
        onlyIconSize: 15,
      },
      Input: {
        activeShadow: `0 0 0 3px ${focusRing}`,
        hoverBorderColor: hoverBorder,
        activeBorderColor: p.textTertiary,
        paddingInline: 10,
      },
      InputNumber: {
        activeShadow: `0 0 0 3px ${focusRing}`,
        hoverBorderColor: hoverBorder,
        activeBorderColor: p.textTertiary,
      },
      Select: {
        activeOutlineColor: focusRing,
        hoverBorderColor: hoverBorder,
        activeBorderColor: p.textTertiary,
        optionSelectedBg: p.bgHover,
        optionSelectedFontWeight: 500,
        optionActiveBg: p.bgHover,
        optionHeight: 32,
        multipleItemBg: p.bgHover,
        multipleItemBorderColor: p.border,
      },
      Checkbox: { borderRadiusSM: 4 },
      Table: {
        headerBg: p.bgHeader,
        headerColor: p.textSecondary,
        headerSplitColor: 'transparent',
        borderColor: p.borderSubtle,
        rowHoverBg: dark ? '#17171a' : '#fafafa',
        rowSelectedBg: p.selected,
        rowSelectedHoverBg: p.selected,
        cellPaddingBlockSM: 8,
        cellPaddingInlineSM: 12,
        cellFontSizeSM: 13.5,
      },
      Tag: { defaultBg: p.bgHover, defaultColor: p.text, borderRadiusSM: 6 },
      Card: { headerFontSize: 14, paddingLG: 20, borderRadiusLG: 12 },
      Modal: {
        titleFontSize: 16,
        titleColor: p.ink,
        contentBg: elevated,
        headerBg: elevated,
        footerBg: elevated,
        borderRadiusLG: 14,
      },
      Drawer: { paddingLG: 24, footerPaddingBlock: 12 },
      Dropdown: { borderRadiusLG: 10, paddingBlock: 6, controlPaddingHorizontal: 10 },
      Popover: { borderRadiusLG: 12 },
      Tooltip: { borderRadius: 6, fontSize: 12 },
      Segmented: {
        trackBg: p.bgHover,
        itemSelectedBg: dark ? '#27272a' : '#ffffff',
        itemColor: p.textSecondary,
        itemHoverColor: p.ink,
        itemSelectedColor: p.ink,
        borderRadius: 8,
        borderRadiusSM: 6,
      },
      Alert: { borderRadiusLG: 10, withDescriptionPadding: '12px 14px' },
      Progress: { defaultColor: blue, remainingColor: p.bgHover },
      Badge: { textFontSizeSM: 11 },
      Divider: { colorSplit: p.borderSubtle },
      Message: { contentBg: elevated },
    },
  }
}

/** CSS variables for the app's own (non-antd) styles in global.css. */
export function cssVars(dark: boolean): Record<string, string> {
  const p = dark ? PALETTE.dark : PALETTE.light
  return {
    '--ink': p.ink,
    '--text': p.text,
    '--text-2': p.textSecondary,
    '--text-3': p.textTertiary,
    '--border': p.border,
    '--border-subtle': p.borderSubtle,
    '--bg': p.bg,
    '--bg-sidebar': p.bgSidebar,
    '--bg-hover': p.bgHover,
    '--bg-header': p.bgHeader,
    '--selected': p.selected,
    '--accent': ACCENT,
    '--accent-soft': dark ? '#172554' : '#eff6ff',
    '--success': '#16a34a',
    '--warning': '#d97706',
    '--on-ink': p.onInk,
    '--primary': dark ? BLUE_DARK : BLUE,
    '--primary-soft': dark ? 'rgba(59,130,246,.16)' : '#eaf2ff',
    '--primary-text': dark ? '#93c5fd' : '#1559d6',
    '--font': FONT,
    '--mono': MONO,
    '--shadow-sm': softShadowOf(dark),
    '--shadow-pop': popShadowOf(dark),
  }
}
