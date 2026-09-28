import type { SVGProps } from 'react';
import type { Profession } from '../types';

type ProfessionIconProps = Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> & {
  profession?: Profession;
  size?: number | string;
};

function ProfessionSymbol({ profession }: { profession: Profession }) {
  switch (profession) {
    case 'barber':
      return (
        <>
          <rect x="8" y="5" width="16" height="22" rx="7" fill="currentColor" opacity=".12" />
          <rect x="9.5" y="6.5" width="13" height="19" rx="5.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M10.2 13.4 16.8 6.8M9.8 21.7 22.1 9.4M15.1 25.2l7.2-7.2" stroke="currentColor" strokeWidth="2.5" />
          <path d="M9 4h14a2 2 0 0 1 2 2v1H7V6a2 2 0 0 1 2-2ZM9 25h14a2 2 0 0 1 2 2v1H7v-1a2 2 0 0 1 2-2Z" fill="currentColor" />
        </>
      );
    case 'manicure':
      return (
        <>
          <rect x="7" y="12" width="18" height="17" rx="5" fill="currentColor" opacity=".12" />
          <rect x="8.5" y="13.5" width="15" height="15" rx="4" stroke="currentColor" strokeWidth="1.8" />
          <path d="M11 4h10v7H11z" fill="currentColor" />
          <path d="M12.5 20.2c1.9-2 5.1-2 7 0v4.2c-1.9 2-5.1 2-7 0v-4.2Z" fill="currentColor" />
          <path d="M26.5 5.5v5M24 8h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      );
    case 'carwash':
      return (
        <>
          <path d="M4.5 17.5 8 9h16l3.5 8.5v8H4.5v-8Z" fill="currentColor" opacity=".12" />
          <path d="M4.5 17.5 8 9h16l3.5 8.5v8H4.5v-8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="m9 16 2-5h10l2 5H9Z" fill="currentColor" opacity=".45" />
          <path d="M8.5 20.5h3M20.5 20.5h3" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M8 25.5v2M24 25.5v2" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
          <path d="M5.5 7.5c0-1.4 1.5-2.3 1.5-3.6 1.5 1.3 3 2.2 3 3.6a2.25 2.25 0 0 1-4.5 0Z" fill="currentColor" />
          <path d="M25.5 5.5v4M23.5 7.5h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      );
    case 'hairstylist':
      return (
        <>
          <path d="M4.5 29c4.4-4.4 5.8-8.8 5.8-14.3C10.3 7.3 14.6 3 21 3c5.9 0 9.6 4.5 9.6 10.8 0 6.2-2.1 11.5-6.4 15.2H4.5Z" fill="currentColor" opacity=".12" />
          <path d="M5 29c4.1-4.4 5.3-8.8 5.3-14.3C10.3 7.3 14.6 3 21 3c5.9 0 9.6 4.5 9.6 10.8 0 6.2-2.1 11.5-6.4 15.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M13.7 15.1c5.3-.5 9.1-3.2 11.5-8.1.8 4.8 2.7 7.9 5.4 9.5M16.1 14.4c.2 6.5-1.8 11.3-6.2 14.6M20.5 13.1c.5 6.7-.8 11.9-4.1 15.9" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" />
        </>
      );
    case 'lash':
      return (
        <>
          <path d="M2.5 21.2C9.8 13.8 20.2 12.5 29.1 18.6c-8.7-3.4-17.6-2.55-26.6 2.6Z" fill="currentColor" />
          <path d="M7.1 22.25c4.7 3.85 11.5 4.15 17.25.2" stroke="currentColor" strokeOpacity=".48" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M17.9 16.35c1.75-2.55 2.6-5.05 2.55-7.5M21.8 16.3c2.8-2.5 4.55-5.2 5.2-8.1M25.4 17.15c2.75-1.6 4.8-3.65 5.9-6.1" stroke="currentColor" strokeWidth="2.05" strokeLinecap="round" />
        </>
      );
    case 'makeup':
      return (
        <>
          <path d="M9 15h14v11H9z" fill="currentColor" opacity=".12" />
          <path d="M10.5 14.5h11v11h-11z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 14V8.4L19.5 3c2.2 1.5 3.2 3.4 2.6 5.8L19 14h-7Z" fill="currentColor" />
          <path d="M8 25h16v4H8z" fill="currentColor" />
          <path d="M26.5 7v5M24 9.5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      );
    case 'esthetician':
      return (
        <>
          <path d="M16 3C8.8 6.6 5.2 12 5.2 19.1 5.2 25.2 9.4 29 16 29s10.8-3.8 10.8-9.9C26.8 12 23.2 6.6 16 3Z" fill="currentColor" opacity=".12" />
          <path d="M17.2 6.2c-5.5 0-9.4 4.5-9.4 10.1 0 3.5 1.5 5.6 3.3 7.2V29M17.2 6.2c4 .9 6.9 4.4 6.9 8.6 0 2.9-1.3 4.7-3.2 6-1.4.9-2.1 2.2-2.1 3.8v1.7h-7.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12.5 19.1c1.4 1 2.8 1 4.2 0" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
          <path d="M24.8 23.2c2.7-.2 4.4 1 5.2 3.4-2.5.7-4.5-.2-5.7-2.6-.6 2.3-2 4-4.2 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12.8" cy="14.6" r="1" fill="currentColor" />
        </>
      );
    default:
      return null;
  }
}

export function ProfessionIcon({
  profession = 'barber',
  size = 32,
  className,
  ...props
}: ProfessionIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={['profession-symbol', className].filter(Boolean).join(' ')}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <ProfessionSymbol profession={profession} />
    </svg>
  );
}
