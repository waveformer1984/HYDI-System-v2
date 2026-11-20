import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  children: ReactNode;
};

const variants: Record<NonNullable<Props['variant']>, string> = {
  primary: 'bg-accent text-accent-foreground hover:bg-blue-700',
  secondary: 'border border-slate-300 dark:border-slate-600 bg-surface hover:bg-slate-100 dark:hover:bg-slate-800',
  ghost: 'hover:bg-slate-100 dark:hover:bg-slate-800',
};

export function Button({ variant = 'primary', className = '', children, ...rest }: Props) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}