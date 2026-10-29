import * as Primitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** A panel that slides in from the side, built on an accessible dialog. */

export const Sheet = Primitive.Root;
export const SheetTrigger = Primitive.Trigger;
export const SheetClose = Primitive.Close;

export const SheetContent = forwardRef<
  ElementRef<typeof Primitive.Content>,
  ComponentPropsWithoutRef<typeof Primitive.Content> & { side?: 'left' | 'right' }
>(({ className, children, side = 'right', ...props }, ref) => (
  <Primitive.Portal>
    <Primitive.Overlay className="fixed inset-0 z-40 bg-black/30" />
    <Primitive.Content
      ref={ref}
      className={cn(
        'fixed inset-y-0 z-50 flex w-full max-w-lg flex-col bg-card shadow-xl outline-none',
        side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
        className,
      )}
      {...props}
    >
      {children}
      <Primitive.Close
        className="absolute top-3 right-3 rounded-md p-1.5 text-muted-foreground hover:bg-muted"
        aria-label="Close"
      >
        <X className="size-4" />
      </Primitive.Close>
    </Primitive.Content>
  </Primitive.Portal>
));
SheetContent.displayName = 'SheetContent';

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-b px-5 py-4 pr-12', className)} {...props} />;
}

export function SheetTitle({ className, ...props }: ComponentPropsWithoutRef<typeof Primitive.Title>) {
  return <Primitive.Title className={cn('text-base font-semibold', className)} {...props} />;
}

export function SheetDescription({ className, ...props }: ComponentPropsWithoutRef<typeof Primitive.Description>) {
  return <Primitive.Description className={cn('mt-1 text-sm text-muted-foreground', className)} {...props} />;
}
