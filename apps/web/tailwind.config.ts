import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    screens: {
      sm: '640px',
      md: '800px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      ink: {
        DEFAULT: '#0F0E0C',
        900: '#0F0E0C',
        800: '#16140F',
        700: '#1E1B16',
        600: '#2A2620',
        500: '#3A352C',
        400: '#5A5247',
        300: '#857C6D',
        200: '#B6AD9C',
        100: '#D8CFBD',
      },
      parchment: {
        DEFAULT: '#F2EDE3',
        50: '#FBF9F4',
        100: '#F6F2E9',
        200: '#F2EDE3',
        300: '#E8E1D2',
        400: '#D8CFBD',
      },
      ember: {
        DEFAULT: '#E25822',
        500: '#E25822',
        600: '#C44717',
        400: '#EF7A4A',
        300: '#F6A481',
      },
      moss: {
        DEFAULT: '#4F7942',
        600: '#3F6434',
        500: '#4F7942',
        400: '#6F9960',
        300: '#9EBC90',
      },
      rust: {
        DEFAULT: '#B33A23',
        600: '#8E2E1A',
        500: '#B33A23',
        400: '#D5624B',
        300: '#E59782',
      },
      ochre: {
        DEFAULT: '#C9962B',
        600: '#A47820',
        500: '#C9962B',
        400: '#DEB252',
        300: '#EBCD8B',
      },
      sky: {
        DEFAULT: '#3B6E8F',
        500: '#3B6E8F',
        400: '#5E8FAE',
      },
    },
    fontFamily: {
      display: [
        'Fraunces',
        'ui-serif',
        'Georgia',
        'Cambria',
        '"Times New Roman"',
        'serif',
      ],
      mono: [
        '"JetBrains Mono"',
        'ui-monospace',
        'SFMono-Regular',
        'Menlo',
        'Monaco',
        'Consolas',
        'monospace',
      ],
      sans: [
        '"JetBrains Mono"',
        'ui-monospace',
        'Menlo',
        'Monaco',
        'monospace',
      ],
    },
    fontSize: {
      '2xs': ['10px', { lineHeight: '14px', letterSpacing: '0.08em' }],
      xs: ['11px', { lineHeight: '16px', letterSpacing: '0.06em' }],
      sm: ['13px', { lineHeight: '20px' }],
      base: ['14px', { lineHeight: '22px' }],
      md: ['16px', { lineHeight: '24px' }],
      lg: ['19px', { lineHeight: '28px' }],
      xl: ['24px', { lineHeight: '30px', letterSpacing: '-0.01em' }],
      '2xl': ['32px', { lineHeight: '36px', letterSpacing: '-0.02em' }],
      '3xl': ['44px', { lineHeight: '48px', letterSpacing: '-0.025em' }],
      '4xl': ['60px', { lineHeight: '62px', letterSpacing: '-0.03em' }],
      '5xl': ['86px', { lineHeight: '86px', letterSpacing: '-0.04em' }],
    },
    extend: {
      boxShadow: {
        stamp: '0 0 0 1px #0F0E0C, 3px 3px 0 0 #0F0E0C',
        'stamp-ember': '0 0 0 1px #E25822, 3px 3px 0 0 #E25822',
        card: '0 1px 0 0 rgba(15,14,12,0.08), 0 0 0 1px rgba(15,14,12,0.1)',
        inset: 'inset 0 0 0 1px rgba(15,14,12,0.12)',
      },
      backgroundImage: {
        grain:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.06 0 0 0 0 0.06 0 0 0 0 0.05 0 0 0 0.08 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        ruled:
          'repeating-linear-gradient(to bottom, transparent 0, transparent 23px, rgba(15,14,12,0.06) 23px, rgba(15,14,12,0.06) 24px)',
      },
      animation: {
        'slide-in': 'slideIn 280ms cubic-bezier(.2,.8,.2,1)',
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
        tick: 'tick 1s steps(2, end) infinite',
        marquee: 'marquee 22s linear infinite',
      },
      keyframes: {
        slideIn: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        tick: {
          '0%,50%': { opacity: '1' },
          '51%,100%': { opacity: '0.2' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
