export function Logo({ className = 'h-6 w-6' }) {
  return <img src="/logo.png" alt="Deploy Maintainer" className={`object-contain ${className}`} draggable={false} />;
}
