'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { cariinApi } from '@cariin/http-client';
import { formatRupiah, formatDate } from '@/utils/currency';
import type { Order } from '@/types/api';

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    setIsLoading(true);
    try {
      const res = await cariinApi
        .get(`v1/orders?page=${page}&limit=20`)
        .json<{ success: true; data: { orders: Order[]; total: number } }>();
      
      if (res.data.orders.length === 0) {
        setHasMore(false);
      } else {
        setOrders((prev) => [...prev, ...res.data.orders]);
        setHasMore(prev.length + res.data.orders.length < res.data.total);
      }
    } catch (err) {
      console.error('Failed to fetch orders:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMore = () => {
    setPage((prev) => prev + 1);
  };

  const getStatusColor = (status: Order['status']) => {
    switch (status) {
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-800';
      case 'PROCESSING':
        return 'bg-blue-100 text-blue-800';
      case 'COMPLETED':
        return 'bg-green-100 text-green-800';
      case 'CANCELLED':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Riwayat Pesanan</h1>

      {orders.length === 0 && !isLoading ? (
        <div className="text-center py-12 text-gray-500">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-lg mb-4">Belum ada pesanan</p>
          <Link
            href="/"
            className="inline-block bg-primary text-white py-2 px-6 rounded-md hover:bg-primary/90 transition-colors"
          >
            Mulai Belanja
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {orders.map((order) => (
              <div
                key={order.id}
                className="bg-white rounded-lg p-4 shadow-sm border border-gray-100"
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-100">
                  <div>
                    <p className="text-sm text-gray-500">Order ID: {order.id.slice(0, 8)}...</p>
                    <p className="text-xs text-gray-400">{formatDate(order.createdAt)}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                    {order.status}
                  </span>
                </div>

                {/* Items */}
                <div className="space-y-2 mb-3">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-gray-900">{item.serviceName}</span>
                        <span className="text-sm text-gray-500">x{item.quantity}</span>
                      </div>
                      <span className="text-sm text-gray-600">{formatRupiah(item.subtotal)}</span>
                    </div>
                  ))}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                  <div>
                    {order.notes && (
                      <p className="text-xs text-gray-500 italic">Catatan: {order.notes}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">Total</p>
                    <p className="text-lg font-bold text-primary">{formatRupiah(order.totalAmount)}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-3 flex gap-2">
                  <Link
                    href={`/orders/${order.id}`}
                    className="flex-1 bg-gray-100 text-gray-700 py-2 px-4 rounded-md text-center text-sm hover:bg-gray-200 transition-colors"
                  >
                    Lihat Detail
                  </Link>
                  {(order.status === 'PENDING' || order.status === 'PROCESSING') && (
                    <button
                      onClick={async () => {
                        if (!confirm('Yakin ingin membatalkan pesanan ini?')) return;
                        try {
                          await cariinApi.post(`v1/orders/${order.id}/cancel`).json();
                          fetchOrders();
                        } catch (err) {
                          console.error('Failed to cancel order:', err);
                        }
                      }}
                      className="flex-1 bg-red-50 text-red-600 py-2 px-4 rounded-md text-sm hover:bg-red-100 transition-colors"
                    >
                      Batal
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {isLoading && (
            <div className="text-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto"></div>
            </div>
          )}

          {hasMore && !isLoading && (
            <button
              onClick={loadMore}
              className="w-full bg-gray-100 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-200 transition-colors"
            >
              Muat Lebih Banyak
            </button>
          )}
        </>
      )}
    </div>
  );
}
