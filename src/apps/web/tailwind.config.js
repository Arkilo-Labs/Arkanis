/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Liquid Glass - 极简灰白配色
        // 背景层次
        'canvas': '#f5f5f7',            // 主背景 - 苹果灰
        'surface': '#ffffff',           // 卡片表面
        'elevated': '#fafafa',          // 悬浮表面
        'sunken': '#ebebed',            // 凹陷区域

        // 文字层次
        'ink': {
          DEFAULT: '#1d1d1f',           // 主文字 - 苹果黑
          'secondary': '#424245',       // 次级文字
          'tertiary': '#6e6e73',        // 辅助文字
          'muted': '#aeaeb2',           // 禁用/占位
        },

        // 边框和分隔
        'border': {
          DEFAULT: 'rgba(0, 0, 0, 0.06)',
          'strong': 'rgba(0, 0, 0, 0.1)',
        },

        // 玻璃效果
        'glass': {
          'bg': 'rgba(255, 255, 255, 0.72)',
          'border': 'rgba(0, 0, 0, 0.04)',
          'highlight': 'rgba(255, 255, 255, 0.9)',
        },

        // 单一强调色 - 极简蓝（仅用于CTA和链接）
        'blue': {
          DEFAULT: '#007aff',           // iOS 系统蓝
          'light': '#5ac8fa',
          'hover': '#0066d6',
        },

        // 状态色（仅在需要时使用）
        'green': '#34c759',
        'red': '#ff3b30',
        'orange': '#ff9500',
      },

      fontFamily: {
        sans: ['Inter', 'SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['SF Mono', 'JetBrains Mono', 'Consolas', 'monospace'],
      },

      borderRadius: {
        'glass': '16px',
        'glass-lg': '20px',
        'glass-xl': '24px',
      },

      boxShadow: {
        'glass': '0 2px 8px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.06)',
        'glass-lg': '0 4px 16px rgba(0, 0, 0, 0.06), 0 12px 40px rgba(0, 0, 0, 0.08)',
        'glass-sm': '0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.04)',
        'inset': 'inset 0 1px 2px rgba(0, 0, 0, 0.04)',
        'button': '0 1px 2px rgba(0, 0, 0, 0.1), 0 4px 12px rgba(0, 122, 255, 0.15)',
      },

      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
      },

      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
