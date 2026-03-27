import { Paper } from '@mantine/core';
import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface DraggableDetailProps {
  initialX: number;
  initialY: number;
  children: React.ReactNode;
}

export const DraggableDetail = ({ initialX, initialY, children }: DraggableDetailProps) => {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const dragOffset = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only drag from the panel itself, not interactive children
      if ((e.target as HTMLElement).closest('button, input, select, a, [data-nodrag]')) return;
      dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.stopPropagation();
    },
    [pos],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOffset.current) return;
    setPos({
      x: e.clientX - dragOffset.current.x,
      y: e.clientY - dragOffset.current.y,
    });
  }, []);

  const onPointerUp = useCallback(() => {
    dragOffset.current = null;
  }, []);

  return createPortal(
    <Paper
      shadow="xl"
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 1000,
        cursor: dragOffset.current ? 'grabbing' : 'grab',
        userSelect: 'none',
        padding: 0,
        overflow: 'hidden',
        maxWidth: '90vw',
        maxHeight: '90vh',
        overflowY: 'auto',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {children}
    </Paper>,
    document.body,
  );
};
