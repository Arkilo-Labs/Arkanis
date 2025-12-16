/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Swiss Spa / Premium Dark Palette
        obsidian: '#0B0C10',       // Deepest background
        charcoal: '#1F2833',       // Card background / Secondary
        mist: '#C5C6C7',           // Muted text
        snow: '#FFFFFF',           // Primary text
        'neon-teal': '#66FCF1',    // Primary Accent (Vibrant)
        'deep-teal': '#45A29E',    // Secondary Accent (Subtle)
        'surface': 'rgba(31, 40, 51, 0.7)', // Glassmorphism base
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        'glow': '0 0 20px rgba(102, 252, 241, 0.15)',
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        }
      }
    },
  },
  plugins: [],
}
