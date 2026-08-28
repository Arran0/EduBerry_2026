-- ============================================================================
-- Migration: Widen bus_payment_method
--
-- Enum drift found while surveying the bus module for the transport rebuild:
-- src/lib/bus.ts:23 declares BusPaymentMethod as
--   'razorpay' | 'upi_qr' | 'cash' | 'card' | 'bank' | 'cheque'
-- and BUS_OFFLINE_METHODS offers card/bank/cheque in the "record offline
-- payment" modal — but add_bus_manager.sql:14 only ever created
--   ('razorpay', 'upi_qr', 'cash')
-- so recordBusOfflinePayment() fails at insert time for those three.
--
-- Kept as its own file because ALTER TYPE ... ADD VALUE cannot be followed by
-- use of the new value in the same transaction, so it must not be bundled with
-- DDL that references it.
-- Run this in the Supabase SQL Editor before transport_r1_foundation.sql.
-- ============================================================================

ALTER TYPE public.bus_payment_method ADD VALUE IF NOT EXISTS 'card';
ALTER TYPE public.bus_payment_method ADD VALUE IF NOT EXISTS 'bank';
ALTER TYPE public.bus_payment_method ADD VALUE IF NOT EXISTS 'cheque';

NOTIFY pgrst, 'reload schema';
