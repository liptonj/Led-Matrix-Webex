'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSession, signOut, isSupabaseConfigured, onAuthStateChange } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface User {
  email?: string;
}

function getInitials(email?: string): string {
  if (!email) return '?';
  const parts = email.split('@')[0].split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return email.substring(0, 2).toUpperCase();
}

export function Avatar() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function checkAuth() {
      if (!isSupabaseConfigured()) {
        setLoading(false);
        return;
      }

      try {
        const { data } = await getSession();
        if (data?.session?.user) {
          setUser({ email: data.session.user.email || undefined });
        } else {
          setUser(null);
        }
      } catch (err) {
        console.error('Auth check failed:', err);
        setUser(null);
      }
      setLoading(false);
    }

    checkAuth();

    // Listen for auth state changes
    let subscription: { unsubscribe: () => void } | null = null;
    
    if (isSupabaseConfigured()) {
      onAuthStateChange(async () => {
        await checkAuth();
      }).then((result) => {
        if (result?.data?.subscription) {
          subscription = result.data.subscription;
        }
      }).catch((err) => {
        console.error('Failed to set up auth listener:', err);
      });
    }

    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleLogout = async () => {
    try {
      await signOut();
      setUser(null);
      setIsOpen(false);
      router.push('/');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  if (loading || !isSupabaseConfigured()) {
    return null;
  }

  const initials = user?.email ? getInitials(user.email) : '?';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'w-10 h-10 rounded-full flex items-center justify-center',
          'bg-[var(--color-primary)] text-white',
          'hover:opacity-90 transition-opacity',
          'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
          'border-2 border-[var(--color-border)]'
        )}
        aria-label={user ? 'User menu' : 'Login'}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        {user ? (
          <span className="text-sm font-semibold">{initials}</span>
        ) : (
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        )}
      </button>

      {isOpen && (
        <div
          className={cn(
            'absolute right-0 mt-2 w-48 rounded-lg shadow-lg z-50',
            'bg-[var(--color-surface)] border border-[var(--color-border)]',
            'py-1'
          )}
        >
          {user ? (
            <>
              <div className="px-4 py-2 border-b border-[var(--color-border)]">
                <p className="text-sm font-medium text-[var(--color-text)] truncate">
                  {user.email}
                </p>
              </div>
              <Link
                href="/admin"
                onClick={() => setIsOpen(false)}
                className="block px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] transition-colors"
              >
                Admin
              </Link>
              <Link
                href="/"
                onClick={() => setIsOpen(false)}
                className="block px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] transition-colors"
              >
                Home
              </Link>
              <button
                onClick={handleLogout}
                className="block w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-[var(--color-bg-hover)] transition-colors"
              >
                Logout
              </button>
            </>
          ) : (
            <Link
              href="/admin/login"
              onClick={() => setIsOpen(false)}
              className="block px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              Login
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
