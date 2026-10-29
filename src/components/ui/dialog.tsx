import * as Primitive from '@radix-ui/react-dialog';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** A centred dialog for confirmations. */

export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;

export const DialogContent = forwardRef<
  ElementRef<typeof Primitive.Content>,
  ComponentPropsWithoutRef<typeof Primitive.Content>
>(({ className, ...props }, ref) => (
  <Primitive.Portal>
    <Primitive.Overlay className="fixed inset-0 z-40 bg-black/30" />
    <Primitive.Content
      ref={ref}
      className={cn(
        'fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card p-5 shadow-xl outline-none',
        className,
      )}
      {...props}
    />
  </Primitive.Portal>
));
DialogContent.displayName = 'DialogContent';

export function DialogTitle({ className, ...props }: ComponentPropsWithoutRef<typeof Primitive.Title>) {
  return <Primitive.Title className={cn('text-base font-semibold', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentPropsWithoutRef<typeof Primitive.Description>) {
  return <Primitive.Description className={cn('mt-1.5 text-sm text-muted-foreground', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-5 flex justify-end gap-2', className)} {...props} />;
}
