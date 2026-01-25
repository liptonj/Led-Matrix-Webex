import { cn } from '@/lib/utils';
import { HTMLAttributes, forwardRef, TableHTMLAttributes } from 'react';

interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  responsive?: boolean;
}

export const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ className, responsive = true, ...props }, ref) => {
    const table = (
      <table
        ref={ref}
        className={cn('w-full border-collapse my-4', className)}
        {...props}
      />
    );

    if (responsive) {
      return (
        <div className="overflow-x-auto">
          {table}
        </div>
      );
    }

    return table;
  }
);

Table.displayName = 'Table';

export const TableHead = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn(className)} {...props} />
));

TableHead.displayName = 'TableHead';

export const TableBody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn(className)} {...props} />
));

TableBody.displayName = 'TableBody';

export const TableRow = forwardRef<
  HTMLTableRowElement,
  HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr ref={ref} className={cn(className)} {...props} />
));

TableRow.displayName = 'TableRow';

export const TableHeader = forwardRef<
  HTMLTableCellElement,
  HTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'p-3 text-left border-b border-[var(--color-border)] font-semibold text-sm',
      'bg-[var(--color-surface-alt)]',
      className
    )}
    {...props}
  />
));

TableHeader.displayName = 'TableHeader';

export const TableCell = forwardRef<
  HTMLTableCellElement,
  HTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'p-3 text-left border-b border-[var(--color-border)] text-sm',
      className
    )}
    {...props}
  />
));

TableCell.displayName = 'TableCell';
