'use client';

import React from 'react';

interface Transaction {
  id: string;
  type: 'topup' | 'payment' | 'refund';
  amount: number;
  description: string;
  status: 'pending' | 'success' | 'failed';
  date: string;
}

interface TransactionItemProps {
  transaction: Transaction;
}

export function TransactionItem({ transaction }: TransactionItemProps) {
  const formatRupiah = (amount: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const getStatusColor = (status: Transaction['status']) => {
    switch (status) {
      case 'success':
        return 'text-green-600 bg-green-50';
      case 'pending':
        return 'text-yellow-600 bg-yellow-50';
      case 'failed':
        return 'text-red-600 bg-red-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  const getTypeIcon = (type: Transaction['type']) => {
    switch (type) {
      case 'topup':
        return (
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
        );
      case 'payment':
        return (
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </div>
        );
      case 'refund':
        return (
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </div>
        );
    }
  };

  const getAmountSign = (type: Transaction['type']) => {
    switch (type) {
      case 'topup':
      case 'refund':
        return '+';
      case 'payment':
        return '-';
      default:
        return '';
    }
  };

  const statusLabels = {
    success: 'Berhasil',
    pending: 'Menunggu',
    failed: 'Gagal',
  };

  return (
    <div className="flex items-center justify-between p-4 bg-white rounded-xl border border-gray-100 hover:border-gray-200 transition-all duration-200 shadow-sm">
      <div className="flex items-center gap-3">
        {getTypeIcon(transaction.type)}
        <div>
          <p className="font-medium text-gray-900">{transaction.description}</p>
          <p className="text-sm text-gray-500">{formatDate(transaction.date)}</p>
        </div>
      </div>
      <div className="text-right">
        <p className={`font-semibold ${transaction.type === 'payment' ? 'text-red-600' : 'text-green-600'}`}>
          {getAmountSign(transaction.type)}{formatRupiah(transaction.amount)}
        </p>
        <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(transaction.status)}`}>
          {statusLabels[transaction.status]}
        </span>
      </div>
    </div>
  );
}
