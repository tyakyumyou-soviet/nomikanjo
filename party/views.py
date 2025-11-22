import json
import math
from decimal import Decimal, ROUND_HALF_UP, getcontext
from datetime import timedelta

from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse, HttpResponseBadRequest
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import ensure_csrf_cookie
from django.utils import timezone

from .models import Session, Member, HistoryItem, Order, Allocation

getcontext().prec = 28  # 十分な精度

def D(v):
    try:
        return Decimal(str(v))
    except Exception:
        return Decimal(0)

def serialize_session(s):
    """
    セッション詳細（クライアント向け）。
    セキュリティのためパスワード自体は含めず has_password フラグのみ返す。
    """
    return {
        'id': s.id,
        'name': s.name,
        'store_name': s.store_name,
        'has_password': bool(s.password),
        'created_at': s.created_at.isoformat(),
        'lat': s.lat,
        'lng': s.lng,
        'tax_mode': s.tax_mode,
        'tax_rate': s.tax_rate,
        'discount_type': s.discount_type,
        'discount_value': s.discount_value,
        'members': [ {'id': m.id, 'name': m.name} for m in s.members.all() ],
        'history': [ {'item': h.item, 'price': h.price} for h in s.history.all().order_by('-id')[:200] ],
        'orders': [
            {
                'id': o.id,
                'item': o.item,
                'price': int(o.price),
                # qty may be Decimal/float in DB; ensure safe serialisation (float)
                'qty': float(o.qty),
                'allocations': [ {'member_id': a.member.id, 'qty': float(a.qty)} for a in o.allocations.all() ]
            } for o in s.orders.all().order_by('created_at')
        ]
    }

@ensure_csrf_cookie
def home_view(request):
    # cleanup handled by middleware; here only list
    sessions = Session.objects.order_by('-created_at').all()
    return render(request, 'party/home.html', {'sessions': sessions})

@ensure_csrf_cookie
def session_detail_view(request, session_id):
    s = get_object_or_404(Session, id=session_id)
    return render(request, 'party/session_detail.html', {'session': s})

@require_http_methods(['GET','POST'])
def api_sessions(request):
    if request.method == 'GET':
        sessions = Session.objects.order_by('-created_at').all()
        data = [ {'id': s.id, 'name': s.name, 'store_name': s.store_name,
                  'created_at': s.created_at.isoformat(),
                  'lat': s.lat, 'lng': s.lng,
                  'has_password': bool(s.password)} for s in sessions ]
        return JsonResponse({'sessions': data})
    else:
        try:
            data = json.loads(request.body.decode('utf-8'))
        except Exception:
            return HttpResponseBadRequest("invalid json")
        name = data.get('name')
        if not name:
            return HttpResponseBadRequest("name required")
        store = data.get('store_name')
        password = data.get('password') or ''
        want_loc = data.get('want_loc', False)
        lat = data.get('lat') if want_loc else None
        lng = data.get('lng') if want_loc else None
        s = Session.objects.create(name=name, store_name=store or '', password=password or '',
                                   lat=lat, lng=lng)
        return JsonResponse({'id': s.id, 'url': f'/session/{s.id}/'})

@require_http_methods(['GET'])
def api_session_detail(request, session_id):
    s = get_object_or_404(Session, id=session_id)
    return JsonResponse(serialize_session(s))

@require_http_methods(['POST'])
def api_check_password(request, session_id):
    """
    ホーム上で合言葉を照合するためのエンドポイント。
    body: { "password": "..." }
    結果: { "ok": true }  or { "ok": false }
    """
    s = get_object_or_404(Session, id=session_id)
    try:
        data = json.loads(request.body.decode('utf-8'))
    except Exception:
        return HttpResponseBadRequest("invalid json")
    pw = (data.get('password') or '').strip()
    if (s.password or '').strip() == '':
        # パスワード不要のセッションでも呼ばれる可能性がある → 常に true
        return JsonResponse({'ok': True})
    ok = (pw == (s.password or '').strip())
    return JsonResponse({'ok': bool(ok)})

@require_http_methods(['POST'])
def api_members(request, session_id):
    s = get_object_or_404(Session, id=session_id)
    try:
        data = json.loads(request.body.decode('utf-8'))
    except:
        return HttpResponseBadRequest("invalid json")
    name = data.get('name')
    if not name:
        return HttpResponseBadRequest("name required")
    m = Member.objects.create(session=s, name=name)
    return JsonResponse({'id': m.id, 'name': m.name})

@require_http_methods(['GET','POST'])
def api_orders(request, session_id):
    s = get_object_or_404(Session, id=session_id)
    if request.method == 'GET':
        hist = s.history.all().order_by('-id')[:50]
        return JsonResponse({'history': [{'item': h.item, 'price': h.price} for h in hist]})
    try:
        data = json.loads(request.body.decode('utf-8'))
    except:
        return HttpResponseBadRequest("invalid json")
    orders = data if isinstance(data, list) else [data]
    created = []
    for o in orders:
        item = o.get('item')
        price = int(o.get('price',0))
        qty = D(o.get('qty', 1))
        allocations = o.get('allocations', [])  # list of {member_id, qty}
        order = Order.objects.create(session=s, item=item, price=price, qty=qty)
        for a in allocations:
            mem_id = a.get('member_id') or a.get('id')
            mem_qty = D(a.get('qty', 1))
            try:
                m = Member.objects.get(id=mem_id, session=s)
            except Member.DoesNotExist:
                continue
            Allocation.objects.create(order=order, member=m, qty=mem_qty)
        created.append({'id': order.id, 'item': order.item})
        # history (既存と重複しなければ追加)
        if item and not s.history.filter(item=item, price=price).exists():
            HistoryItem.objects.create(session=s, item=item, price=price)
    return JsonResponse({'created': created})

@require_http_methods(['DELETE'])
def api_order_detail(request, session_id, order_id):
    s = get_object_or_404(Session, id=session_id)
    order = get_object_or_404(Order, id=order_id, session=s)
    order.delete()
    return JsonResponse({'deleted': True})

@require_http_methods(['POST'])
def api_settings(request, session_id):
    s = get_object_or_404(Session, id=session_id)
    try:
        data = json.loads(request.body.decode('utf-8'))
    except:
        return HttpResponseBadRequest("invalid json")
    s.discount_type = data.get('discount_type', s.discount_type)
    s.discount_value = int(data.get('discount_value', s.discount_value) or 0)
    s.tax_mode = data.get('tax_mode', s.tax_mode)
    s.tax_rate = int(data.get('tax_rate', s.tax_rate) or 0)
    s.save()
    return JsonResponse({'ok': True})

@require_http_methods(['GET'])
def api_receipt_data(request, session_id):
    """
    返却値は整数（表示は常に整数）。切り上げ（ceil）ポリシーで最終合計を整数にし、
    各メンバーの合計は小数分配から最大剰余法で整数化して合計が final_total に一致するようにする。
    さらに各メンバーの各注文行（lines）もそのメンバー合計に合うように配分する。
    """
    s = get_object_or_404(Session, id=session_id)

    # 1) 各注文ごとの raw totals（Decimal）
    order_infos = []
    raw_total = D(0)
    for o in s.orders.all():
        order_qty = D(o.qty)
        order_price = D(o.price)
        order_total_raw = (order_price * order_qty).quantize(Decimal('0.0001'))  # 精度保持
        allocations = list(o.allocations.all())
        order_infos.append({'order': o, 'order_total_raw': order_total_raw, 'allocations': allocations})
        raw_total += order_total_raw

    # 2) 割引を各注文に配る（percent / yen / none）
    discount_type = (s.discount_type or 'none')
    discount_value = D(s.discount_value or 0)
    if raw_total == 0:
        for info in order_infos:
            info['order_after_discount'] = D(0)
    else:
        if discount_type == 'percent':
            factor = (D(1) - (discount_value / D(100)))
            for info in order_infos:
                info['order_after_discount'] = (info['order_total_raw'] * factor).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
        elif discount_type == 'yen':
            # Yenの割引を原価比で配る
            for info in order_infos:
                share = (info['order_total_raw'] / raw_total)
                deduction = (discount_value * share).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
                info['order_after_discount'] = (info['order_total_raw'] - deduction).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
        else:
            for info in order_infos:
                info['order_after_discount'] = info['order_total_raw']

    final_before_tax = sum(info['order_after_discount'] for info in order_infos)

    # 3) 税（order単位で計算）。tax_mode == 'exclusive' のとき、各注文に税を分配
    tax_total = D(0)
    tax_rate = D(s.tax_rate or 0)
    if s.tax_mode == 'exclusive':
        for info in order_infos:
            tax = (info['order_after_discount'] * (tax_rate / D(100))).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
            info['order_tax'] = tax
            tax_total += tax
    else:
        for info in order_infos:
            info['order_tax'] = D(0)

    final_total_decimal = (final_before_tax + tax_total).quantize(Decimal('0.0001'))

    # 4) 最終合計は切り上げして整数化（表示のポリシー）
    final_total_int = int(math.ceil(float(final_total_decimal)))  # guarantee int

    # 5) 各注文ごとの「gross_for_order」（割引後＋税）
    for info in order_infos:
        info['gross_for_order'] = (info['order_after_discount'] + info['order_tax']).quantize(Decimal('0.0001'))

    # 6) 各注文の割り当て（allocations）に基づく member 精密額を計算（合計が final_total_decimal に近似するはず）
    per_member_precise = {}
    members = list(s.members.all())
    for m in members:
        per_member_precise[m.id] = D(0)

    # accumulate precise shares per allocation
    for info in order_infos:
        gross = info['gross_for_order']
        # allocationの合計数量（比率） — 0 の可能性あり
        total_share_qty = sum((D(a.qty) for a in info['allocations']))
        if total_share_qty == 0:
            # 割当なし -> 何もしない
            continue
        # 各割当に対して精密額を加算
        for a in info['allocations']:
            member_id = a.member.id
            share_qty = D(a.qty)
            if total_share_qty == 0:
                share_ratio = D(0)
            else:
                share_ratio = (share_qty / total_share_qty)
            person_amount_precise = (gross * share_ratio).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
            per_member_precise[member_id] = per_member_precise.get(member_id, D(0)) + person_amount_precise

    # 7) per_member_precise の合計は通常 final_total_decimal に近いが、整数化の前処理として
    #    各メンバーを整数（合計 final_total_int）にするために largest-remainder（ハミルトン方式）を使う
    # floor と remainder を計算
    floors = {}
    remainders = {}
    sum_floors = 0
    # If final_total_decimal is zero, set all zeros.
    if final_total_decimal == 0:
        for m in members:
            floors[m.id] = 0
            remainders[m.id] = D(0)
        sum_floors = 0
    else:
        # scale proportions to final_total_int based on precise amounts
        total_precise_sum = sum(per_member_precise.values())
        # if total_precise_sum is zero (no allocations), just zero everybody
        if total_precise_sum == 0:
            for m in members:
                floors[m.id] = 0
                remainders[m.id] = D(0)
            sum_floors = 0
        else:
            proportional_exact = {}
            for m in members:
                exact_share = (per_member_precise.get(m.id, D(0)) / total_precise_sum) * D(final_total_int)
                # exact_share is Decimal
                flo = int(math.floor(float(exact_share)))
                rem = exact_share - D(flo)
                floors[m.id] = flo
                remainders[m.id] = rem
                sum_floors += flo

    # distribute remaining (final_total_int - sum_floors) to highest remainders
    remaining = final_total_int - sum_floors
    alloc_ints = {m.id: floors.get(m.id, 0) for m in members}
    if remaining > 0:
        # sort members by remainder desc
        sorted_members = sorted(members, key=lambda mm: float(remainders.get(mm.id, D(0))), reverse=True)
        idx = 0
        while remaining > 0 and idx < len(sorted_members):
            alloc_ints[sorted_members[idx].id] += 1
            remaining -= 1
            idx += 1
        # if still remaining (rare if no members), give to first
        if remaining > 0 and members:
            alloc_ints[members[0].id] += remaining
            remaining = 0

    # 8) build per-member lines (per-order breakdown) and ensure for each member its lines sum to alloc_ints[member]
    members_out = []
    # precompute per-member per-order precise lines
    per_member_lines_precise = {m.id: [] for m in members}
    for info in order_infos:
        o = info['order']
        gross = info['gross_for_order']
        total_share_qty = sum((D(a.qty) for a in info['allocations']))
        if total_share_qty == 0:
            continue
        # compute precise per-allocation amount for this order
        for a in info['allocations']:
            mid = a.member.id
            share_qty = D(a.qty)
            share_ratio = (share_qty / total_share_qty) if total_share_qty != 0 else D(0)
            amt_precise = (gross * share_ratio).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
            per_member_lines_precise[mid].append({
                'order_id': o.id,
                'item': o.item,
                'qty_precise': float(share_qty),
                'amount_precise': amt_precise
            })

    # now for each member, convert their lines to integers that sum to alloc_ints[member]
    for m in members:
        lines = per_member_lines_precise.get(m.id, [])
        # sum precise
        sum_precise = sum((l['amount_precise'] for l in lines), D(0))
        target_int = alloc_ints.get(m.id, 0)
        # if no lines or target_int == 0 => lines integer amounts are zero
        lines_out = []
        if not lines or target_int == 0:
            # create outputs with integer amounts (0)
            for l in lines:
                qty = l['qty_precise']
                lines_out.append({'item': l['item'], 'qty': float(l['qty_precise']), 'amount': 0, 'shared': float(l['qty_precise']) < 1 or len(lines) > 1})
        else:
            # largest remainder per-member across their lines
            # compute exact shares scaled to target_int
            # compute exact share proportion: each line's precise / sum_precise * target_int
            exacts = []
            sum_floor = 0
            for l in lines:
                exact = (l['amount_precise'] / sum_precise) * D(target_int) if sum_precise != 0 else D(0)
                flo = int(math.floor(float(exact)))
                rem = exact - D(flo)
                exacts.append({'orig': l, 'exact': exact, 'floor': flo, 'rem': rem})
                sum_floor += flo
            rem_need = target_int - sum_floor
            # sort by rem desc
            exacts_sorted = sorted(exacts, key=lambda x: float(x['rem']), reverse=True)
            # assign floors + give +1 to top remainders
            for i, ex in enumerate(exacts_sorted):
                add = 1 if i < rem_need else 0
                amount_int = ex['floor'] + add
                lines_out.append({
                    'item': ex['orig']['item'],
                    'qty': float(ex['orig']['qty_precise']),
                    'amount': int(amount_int),
                    'shared': float(ex['orig']['qty_precise']) < 1 or len(lines) > 1
                })
            # order of lines_out currently sorted by remainder; reorder to original order
            # build map from item->counts to restore stable order (use order_id & item)
            # create a keyed dict per order-item to place correctly
            # simpler: produce lines_out in the same iteration order as lines by mapping exacts back
            # rebuild mapping by (item, amount_precise)
            mapped = []
            for l in lines:
                # find one entry in lines_out with same item and amount close to expected and not used
                found_index = None
                for idx_o, out_l in enumerate(lines_out):
                    if out_l.get('_used'):
                        continue
                    if out_l['item'] == l['item']:
                        # accept first match
                        found_index = idx_o
                        break
                if found_index is not None:
                    mapped.append(lines_out[found_index])
                    lines_out[found_index]['_used'] = True
            # if mapped empty fallback to lines_out
            final_lines = []
            if mapped:
                final_lines = mapped
                # remove helper keys
                for it in final_lines:
                    it.pop('_used', None)
            else:
                final_lines = lines_out
                for it in final_lines:
                    it.pop('_used', None)
            lines_out = final_lines

        # sum of lines_out amounts might be slightly different from target_int due to fallback -> adjust to target
        sum_lines_int = sum(l['amount'] for l in lines_out) if lines_out else 0
        diff = target_int - sum_lines_int
        if diff != 0 and lines_out:
            # distribute diff to first lines (could be negative or positive)
            i = 0
            sign = 1 if diff > 0 else -1
            while diff != 0:
                lines_out[i % len(lines_out)]['amount'] += sign
                diff -= sign
                i += 1

        # member_out
        members_out.append({
            'id': m.id,
            'name': m.name,
            'total': int(alloc_ints.get(m.id, 0)),
            'lines': [{'item': l['item'], 'qty': (1 if float(l['qty']) < 1 and float(l['qty']) > 0 else int(round(float(l['qty'])))), 'amount': int(l['amount']), 'shared': bool(l.get('shared', False))} for l in lines_out]
        })

    # 9) orders_out for debugging / optional display (we'll include basic info)
    orders_out = []
    for info in order_infos:
        o = info['order']
        orders_out.append({
            'id': o.id,
            'item': o.item,
            'price': int(o.price),
            'qty': float(o.qty),
            'order_total_after_discount': float(info['order_after_discount']),
            'order_tax': float(info['order_tax']),
            'gross_for_order': float(info['gross_for_order']),
            'allocations': [{'member_id': a.member.id, 'qty': float(a.qty)} for a in info['allocations']]
        })

    # 10) raw_total display: use ceil as well (integer)
    raw_total_int = int(math.ceil(float(raw_total)))

    # discount_text compute
    discount_text = '0'
    if discount_type == 'yen':
        discount_text = f"¥{int(discount_value)}"
    elif discount_type == 'percent':
        discount_text = f"{int(discount_value)}%"

    return JsonResponse({
        'session': {'id': s.id, 'name': s.name, 'store_name': s.store_name, 'created_at': s.created_at.isoformat()},
        'raw_total': raw_total_int,
        'final_total': final_total_int,
        'discount_text': discount_text,
        'members': members_out,
        'orders': orders_out
    })
import json
import math
from decimal import Decimal, ROUND_HALF_UP, getcontext
from datetime import timedelta

from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse, HttpResponseBadRequest
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import ensure_csrf_cookie
from django.utils import timezone

from .models import Session, Member, HistoryItem, Order, Allocation

getcontext().prec = 28  # 十分な精度

def D(v):
    try:
        return Decimal(str(v))
    except Exception:
        return Decimal(0)

def serialize_session(s):
    """
    セッション詳細（クライアント向け）。
    セキュリティ配慮：パスワードそのものは含めず has_password フラグのみ返す。
    """
    return {
        'id': s.id,
        'name': s.name,
        'store_name': s.store_name,
        'has_password': bool(s.password),
        'created_at': s.created_at.isoformat(),
        'lat': s.lat,
        'lng': s.lng,
        'tax_mode': s.tax_mode,
        'tax_rate': s.tax_rate,
        'discount_type': s.discount_type,
        'discount_value': s.discount_value,
        'members': [ {'id': m.id, 'name': m.name} for m in s.members.all() ],
        'history': [ {'item': h.item, 'price': h.price} for h in s.history.all().order_by('-id')[:200] ],
        'orders': [
            {
                'id': o.id,
                'item': o.item,
                'price': int(o.price),
                'qty': float(o.qty),
                'allocations': [ {'member_id': a.member.id, 'qty': float(a.qty)} for a in o.allocations.all() ]
            } for o in s.orders.all().order_by('created_at')
        ]
    }

@ensure_csrf_cookie
def home_view(request):
    sessions = Session.objects.order_by('-created_at').all()
    return render(request, 'party/home.html', {'sessions': sessions})

@ensure_csrf_cookie
def session_detail_view(request, session_id):
    s = get_object_or_404(Session, id=session_id)
    return render(request, 'party/session_detail.html', {'session': s})

@require_http_methods(['GET','POST'])
def api_sessions(request):
    if request.method == 'GET':
        sessions = Session.objects.order_by('-created_at').all()
        data = [ {'id': s.id, 'name': s.name, 'store_name': s.store_name,
                  'created_at': s.created_at.isoformat(),
                  'lat': s.lat, 'lng': s.lng,
                  'has_password': bool(s.password)} for s in sessions ]
        return JsonResponse({'sessions': data})
    else:
        try:
            data = json.loads(request.body.decode('utf-8'))
        except Exception:
            return HttpResponseBadRequest("invalid json")
        name = data.get('name')
        if not name:
            return HttpResponseBadRequest("name required")
        store = data.get('store_name')
        password = data.get('password') or ''
        want_loc = data.get('want_loc', False)
        lat = data.get('lat') if want_loc else None
        lng = data.get('lng') if want_loc else None
        s = Session.objects.create(name=name, store_name=store or '', password=password or '',
                                   lat=lat, lng=lng)
        return JsonResponse({'id': s.id, 'url': f'/session/{s.id}/'})

@require_http_methods(['GET'])
def api_session_detail(request, session_id):
    s = get_object_or_404(Session, id=session_id)
    return JsonResponse(serialize_session(s))

@require_http_methods(['POST'])
def api_check_password(request, session_id):
    """
    Home画面から合言葉をチェックするためのエンドポイント。
    body: { "password": "..." }
    """
    s = get_object_or_404(Session, id=session_id)
    try:
        data = json.loads(request.body.decode('utf-8'))
    except Exception:
        return HttpResponseBadRequest("invalid json")
    pw = (data.get('password') or '').strip()
    if (s.password or '').strip() == '':
        return JsonResponse({'ok': True})
    ok = (pw == (s.password or '').strip())
    return JsonResponse({'ok': bool(ok)})

@require_http_methods(['GET','POST'])
def api_history(request, session_id):
    """
    /api/sessions/<session_id>/history/
    GET: return history list
    POST: add history item (body: {item, price})
    """
    s = get_object_or_404(Session, id=session_id)
    if request.method == 'GET':
        hist = s.history.all().order_by('-id')[:200]
        return JsonResponse({'history': [{'item': h.item, 'price': h.price} for h in hist]})
    else:
        try:
            data = json.loads(request.body.decode('utf-8'))
        except:
            return HttpResponseBadRequest("invalid json")
        item = (data.get('item') or '').strip()
        price = data.get('price')
        if not item:
            return HttpResponseBadRequest("item required")
        try:
            price_int = int(price or 0)
        except:
            price_int = 0
        # 重複チェックは任意 — 今回は同一 item+price が存在しなければ追加
        if not s.history.filter(item=item, price=price_int).exists():
            hi = HistoryItem.objects.create(session=s, item=item, price=price_int)
            return JsonResponse({'ok': True, 'id': hi.id})
        else:
            return JsonResponse({'ok': True, 'message': 'already exists'})

@require_http_methods(['POST'])
def api_members(request, session_id):
    s = get_object_or_404(Session, id=session_id)
    try:
        data = json.loads(request.body.decode('utf-8'))
    except:
        return HttpResponseBadRequest("invalid json")
    name = data.get('name')
    if not name:
        return HttpResponseBadRequest("name required")
    m = Member.objects.create(session=s, name=name)
    return JsonResponse({'id': m.id, 'name': m.name})

@require_http_methods(['GET','POST'])
def api_orders(request, session_id):
    s = get_object_or_404(Session, id=session_id)
    if request.method == 'GET':
        hist = s.history.all().order_by('-id')[:50]
        return JsonResponse({'history': [{'item': h.item, 'price': h.price} for h in hist]})
    try:
        data = json.loads(request.body.decode('utf-8'))
    except:
        return HttpResponseBadRequest("invalid json")
    orders = data if isinstance(data, list) else [data]
    created = []
    for o in orders:
        item = o.get('item')
        price = int(o.get('price',0))
        qty = D(o.get('qty', 1))
        allocations = o.get('allocations', [])  # list of {member_id, qty}
        order = Order.objects.create(session=s, item=item, price=price, qty=qty)
        for a in allocations:
            mem_id = a.get('member_id') or a.get('id')
            mem_qty = D(a.get('qty', 1))
            try:
                m = Member.objects.get(id=mem_id, session=s)
            except Member.DoesNotExist:
                continue
            Allocation.objects.create(order=order, member=m, qty=mem_qty)
        created.append({'id': order.id, 'item': order.item})
        # history追加（重複除外）
        if item and not s.history.filter(item=item, price=price).exists():
            HistoryItem.objects.create(session=s, item=item, price=price)
    return JsonResponse({'created': created})

@require_http_methods(['DELETE'])
def api_order_detail(request, session_id, order_id):
    s = get_object_or_404(Session, id=session_id)
    order = get_object_or_404(Order, id=order_id, session=s)
    order.delete()
    return JsonResponse({'deleted': True})

@require_http_methods(['POST'])
def api_settings(request, session_id):
    s = get_object_or_404(Session, id=session_id)
    try:
        data = json.loads(request.body.decode('utf-8'))
    except:
        return HttpResponseBadRequest("invalid json")
    s.discount_type = data.get('discount_type', s.discount_type)
    s.discount_value = int(data.get('discount_value', s.discount_value) or 0)
    s.tax_mode = data.get('tax_mode', s.tax_mode)
    s.tax_rate = int(data.get('tax_rate', s.tax_rate) or 0)
    s.save()
    return JsonResponse({'ok': True})

@require_http_methods(['GET'])
def api_receipt_data(request, session_id):
    """
    会計計算。サーバーは整数表示（切り上げ）を前提に配分し、
    members[].total は整数、members[].lines[].amount も整数。
    """
    s = get_object_or_404(Session, id=session_id)

    # 1) 各注文 raw total を集計
    order_infos = []
    raw_total = D(0)
    for o in s.orders.all():
        order_qty = D(o.qty)
        order_price = D(o.price)
        order_total_raw = (order_price * order_qty).quantize(Decimal('0.0001'))
        allocations = list(o.allocations.all())
        order_infos.append({'order': o, 'order_total_raw': order_total_raw, 'allocations': allocations})
        raw_total += order_total_raw

    # 2) 割引を各注文へ配分
    discount_type = (s.discount_type or 'none')
    discount_value = D(s.discount_value or 0)
    if raw_total == 0:
        for info in order_infos:
            info['order_after_discount'] = D(0)
    else:
        if discount_type == 'percent':
            factor = (D(1) - (discount_value / D(100)))
            for info in order_infos:
                info['order_after_discount'] = (info['order_total_raw'] * factor).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
        elif discount_type == 'yen':
            for info in order_infos:
                share = (info['order_total_raw'] / raw_total)
                deduction = (discount_value * share).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
                info['order_after_discount'] = (info['order_total_raw'] - deduction).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
        else:
            for info in order_infos:
                info['order_after_discount'] = info['order_total_raw']

    final_before_tax = sum(info['order_after_discount'] for info in order_infos)

    # 3) 税（注文単位）。exclusive の場合は各注文に税をつける
    tax_total = D(0)
    tax_rate = D(s.tax_rate or 0)
    if s.tax_mode == 'exclusive':
        for info in order_infos:
            tax = (info['order_after_discount'] * (tax_rate / D(100))).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
            info['order_tax'] = tax
            tax_total += tax
    else:
        for info in order_infos:
            info['order_tax'] = D(0)

    final_total_decimal = (final_before_tax + tax_total).quantize(Decimal('0.0001'))
    final_total_int = int(math.ceil(float(final_total_decimal)))  # 切り上げで整数表示

    # gross for each order
    for info in order_infos:
        info['gross_for_order'] = (info['order_after_discount'] + info['order_tax']).quantize(Decimal('0.0001'))

    # precise per-member accumulation
    per_member_precise = {}
    members = list(s.members.all())
    for m in members:
        per_member_precise[m.id] = D(0)
    for info in order_infos:
        gross = info['gross_for_order']
        total_share_qty = sum((D(a.qty) for a in info['allocations']))
        if total_share_qty == 0:
            continue
        for a in info['allocations']:
            member_id = a.member.id
            share_qty = D(a.qty)
            share_ratio = (share_qty / total_share_qty) if total_share_qty != 0 else D(0)
            person_amount_precise = (gross * share_ratio).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
            per_member_precise[member_id] = per_member_precise.get(member_id, D(0)) + person_amount_precise

    # largest-remainder を使って final_total_int に合わせて各メンバーを整数化
    floors = {}
    remainders = {}
    sum_floors = 0
    if final_total_decimal == 0:
        for m in members:
            floors[m.id] = 0
            remainders[m.id] = D(0)
        sum_floors = 0
    else:
        total_precise_sum = sum(per_member_precise.values())
        if total_precise_sum == 0:
            for m in members:
                floors[m.id] = 0
                remainders[m.id] = D(0)
            sum_floors = 0
        else:
            for m in members:
                exact_share = (per_member_precise.get(m.id, D(0)) / total_precise_sum) * D(final_total_int)
                flo = int(math.floor(float(exact_share)))
                rem = exact_share - D(flo)
                floors[m.id] = flo
                remainders[m.id] = rem
                sum_floors += flo

    remaining = final_total_int - sum_floors
    alloc_ints = {m.id: floors.get(m.id, 0) for m in members}
    if remaining > 0:
        sorted_members = sorted(members, key=lambda mm: float(remainders.get(mm.id, D(0))), reverse=True)
        idx = 0
        while remaining > 0 and idx < len(sorted_members):
            alloc_ints[sorted_members[idx].id] += 1
            remaining -= 1
            idx += 1
        if remaining > 0 and members:
            alloc_ints[members[0].id] += remaining
            remaining = 0

    # build per-member lines
    per_member_lines_precise = {m.id: [] for m in members}
    for info in order_infos:
        o = info['order']
        gross = info['gross_for_order']
        total_share_qty = sum((D(a.qty) for a in info['allocations']))
        if total_share_qty == 0:
            continue
        for a in info['allocations']:
            mid = a.member.id
            share_qty = D(a.qty)
            share_ratio = (share_qty / total_share_qty) if total_share_qty != 0 else D(0)
            amt_precise = (gross * share_ratio).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
            per_member_lines_precise[mid].append({
                'order_id': o.id,
                'item': o.item,
                'qty_precise': float(share_qty),
                'amount_precise': amt_precise
            })

    members_out = []
    for m in members:
        lines = per_member_lines_precise.get(m.id, [])
        sum_precise = sum((l['amount_precise'] for l in lines), D(0))
        target_int = alloc_ints.get(m.id, 0)
        lines_out = []
        if not lines or target_int == 0:
            for l in lines:
                lines_out.append({'item': l['item'], 'qty': float(l['qty_precise']), 'amount': 0, 'shared': float(l['qty_precise']) < 1 or len(lines) > 1})
        else:
            exacts = []
            sum_floor = 0
            for l in lines:
                exact = (l['amount_precise'] / sum_precise) * D(target_int) if sum_precise != 0 else D(0)
                flo = int(math.floor(float(exact)))
                rem = exact - D(flo)
                exacts.append({'orig': l, 'exact': exact, 'floor': flo, 'rem': rem})
                sum_floor += flo
            rem_need = target_int - sum_floor
            exacts_sorted = sorted(exacts, key=lambda x: float(x['rem']), reverse=True)
            for i, ex in enumerate(exacts_sorted):
                add = 1 if i < rem_need else 0
                amount_int = ex['floor'] + add
                lines_out.append({
                    'item': ex['orig']['item'],
                    'qty': float(ex['orig']['qty_precise']),
                    'amount': int(amount_int),
                    'shared': float(ex['orig']['qty_precise']) < 1 or len(lines) > 1
                })
            # reorder to original order roughly
            mapped = []
            for l in lines:
                found_index = None
                for idx_o, out_l in enumerate(lines_out):
                    if out_l.get('_used'):
                        continue
                    if out_l['item'] == l['item']:
                        found_index = idx_o
                        break
                if found_index is not None:
                    mapped.append(lines_out[found_index])
                    lines_out[found_index]['_used'] = True
            final_lines = mapped if mapped else lines_out
            for it in final_lines:
                it.pop('_used', None)
            lines_out = final_lines

        sum_lines_int = sum(l['amount'] for l in lines_out) if lines_out else 0
        diff = target_int - sum_lines_int
        if diff != 0 and lines_out:
            i = 0
            sign = 1 if diff > 0 else -1
            while diff != 0:
                lines_out[i % len(lines_out)]['amount'] += sign
                diff -= sign
                i += 1

        members_out.append({
            'id': m.id,
            'name': m.name,
            'total': int(alloc_ints.get(m.id, 0)),
            'lines': [{'item': l['item'], 'qty': (1 if float(l['qty']) < 1 and float(l['qty']) > 0 else int(round(float(l['qty'])))), 'amount': int(l['amount']), 'shared': bool(l.get('shared', False))} for l in lines_out]
        })

    orders_out = []
    for info in order_infos:
        o = info['order']
        orders_out.append({
            'id': o.id,
            'item': o.item,
            'price': int(o.price),
            'qty': float(o.qty),
            'order_total_after_discount': float(info['order_after_discount']),
            'order_tax': float(info['order_tax']),
            'gross_for_order': float(info['gross_for_order']),
            'allocations': [{'member_id': a.member.id, 'qty': float(a.qty)} for a in info['allocations']]
        })

    raw_total_int = int(math.ceil(float(raw_total)))
    discount_text = '0'
    if discount_type == 'yen':
        discount_text = f"¥{int(discount_value)}"
    elif discount_type == 'percent':
        discount_text = f"{int(discount_value)}%"

    return JsonResponse({
        'session': {'id': s.id, 'name': s.name, 'store_name': s.store_name, 'created_at': s.created_at.isoformat()},
        'raw_total': raw_total_int,
        'final_total': final_total_int,
        'discount_text': discount_text,
        'members': members_out,
        'orders': orders_out
    })
