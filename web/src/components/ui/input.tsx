import { forwardRef } from 'react';

const INPUT_BASE = 'w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-blue-400 focus:outline-none';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

/** 공통 Input 컴포넌트 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, className = '', ...props }, ref) => {
    return (
      <div>
        {label && <label className="mb-1 block text-xs text-gray-500">{label}</label>}
        <input ref={ref} className={`${INPUT_BASE} ${className}`} {...props} />
      </div>
    );
  },
);
Input.displayName = 'Input';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

/** 공통 Select 컴포넌트 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, className = '', children, ...props }, ref) => {
    return (
      <div>
        {label && <label className="mb-1 block text-xs text-gray-500">{label}</label>}
        <select ref={ref} className={`${INPUT_BASE} ${className}`} {...props}>
          {children}
        </select>
      </div>
    );
  },
);
Select.displayName = 'Select';
