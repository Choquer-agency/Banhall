'use client';
import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useScroll } from '@/components/ui/use-scroll';

interface HeaderProps {
  /** Content rendered on the left after the logo/dashboard link */
  breadcrumb?: React.ReactNode;
  /** Content rendered on the right side */
  actions?: React.ReactNode;
  /** Optional scroll container ref — when provided, listens for scroll on that element instead of window */
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
}

export function Header({ breadcrumb, actions, scrollContainerRef }: HeaderProps) {
  const windowScrolled = useScroll(10);
  const [containerScrolled, setContainerScrolled] = React.useState(false);

  React.useEffect(() => {
    const el = scrollContainerRef?.current;
    if (!el) return;
    const onScroll = () => setContainerScrolled(el.scrollTop > 10);
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollContainerRef]);

  const scrolled = scrollContainerRef ? containerScrolled : windowScrolled;

  return (
    <header
      className={cn(
        'sticky top-0 z-50 w-full transition-all duration-300 ease-out',
        scrolled
          ? 'bg-navy/95 shadow-lg shadow-navy/20 backdrop-blur-lg'
          : 'bg-navy',
      )}
    >
      <nav
        className={cn(
          'mx-auto flex h-14 w-full items-center justify-between px-6 transition-all duration-300 ease-out md:h-12',
          scrolled && 'max-w-6xl px-4',
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/dashboard" className="flex items-center gap-2 flex-shrink-0">
            <Image
              src="/logo.png"
              alt="Banhall"
              width={77}
              height={77}
              className="-my-4 brightness-0 invert"
            />
            <span className="text-sm text-white/60 hover:text-white/80 transition-colors">
              Dashboard
            </span>
          </Link>
          {breadcrumb && (
            <>
              <svg className="h-3 w-3 flex-shrink-0 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              {breadcrumb}
            </>
          )}
        </div>

        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {actions}
          </div>
        )}
      </nav>
    </header>
  );
}
