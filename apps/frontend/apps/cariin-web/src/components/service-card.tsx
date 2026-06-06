import Link from 'next/link';
import { ReactNode } from 'react';

interface ServiceCardProps {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
  colorClass?: string;
}

export function ServiceCard({ href, icon, title, description, colorClass = 'bg-gray-100' }: ServiceCardProps) {
  return (
    <Link
      href={href}
      className="bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow border border-gray-100"
    >
      <div className={`w-12 h-12 ${colorClass} rounded-full flex items-center justify-center mb-3`}>
        {icon}
      </div>
      <h3 className="font-semibold text-gray-900">{title}</h3>
      <p className="text-sm text-gray-500">{description}</p>
    </Link>
  );
}
