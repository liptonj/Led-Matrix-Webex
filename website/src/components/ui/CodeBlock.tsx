import { cn } from '@/lib/utils';
import { HTMLAttributes, forwardRef } from 'react';

interface CodeBlockProps extends HTMLAttributes<HTMLPreElement> {
  code: string;
}

export const CodeBlock = forwardRef<HTMLPreElement, CodeBlockProps>(
  ({ className, code, ...props }, ref) => {
    return (
      <div 
        className={cn(
          'rounded-lg p-5 overflow-x-auto my-4',
          'bg-[var(--color-code-bg)] text-[var(--color-code-text)]',
          className
        )}
      >
        <pre ref={ref} className="m-0 p-0 bg-transparent" {...props}>
          <code className="font-mono text-[0.8125rem] bg-transparent p-0 whitespace-pre-wrap">
            {code}
          </code>
        </pre>
      </div>
    );
  }
);

CodeBlock.displayName = 'CodeBlock';
