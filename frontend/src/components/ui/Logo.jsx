export function LogoMark({ size = 24 }) {
    return (<svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 2.5L27 6.8V15.4C27 21.9 22.4 27.4 16 29.5C9.6 27.4 5 21.9 5 15.4V6.8L16 2.5Z" fill="var(--color-surface-2)" stroke="var(--color-accent)" strokeWidth="1.6"/>
      <path d="M13 12L9.6 16L13 20" stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M19 12L22.4 16L19 20" stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>);
}
export function Logo({ size = 22, showWordmark = true }) {
    return (<div className="flex items-center gap-2">
      <LogoMark size={size}/>
      {showWordmark && (<span className="font-display text-[15px] font-semibold tracking-tight text-[var(--color-text)]">
          RepoGuard
        </span>)}
    </div>);
}
