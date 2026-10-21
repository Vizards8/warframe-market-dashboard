"""Private, in-memory WFM session and reviewed order edits. Never part of public state."""
import copy
import hashlib
import json
import re
import secrets
import subprocess
import threading
import time

API = 'https://api.warframe.market/v2'
USER_AGENT = 'VoidLedger/0.4 (+https://github.com/Vizards8/warframe-market-dashboard)'
ORDER_FIELDS = ('id', 'itemId', 'type', 'platinum', 'quantity', 'perTrade', 'visible',
                'rank', 'charges', 'subtype', 'amberStars', 'cyanStars', 'updatedAt')


class ConnectorError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def revision(order):
    value = {key: order.get(key) for key in ORDER_FIELDS}
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class Connector:
    def __init__(self, transport=None):
        self.lock = threading.RLock()
        self.transport = transport or self._http
        self.csrf = secrets.token_urlsafe(32)
        self.token = None
        self.user = None
        self.plans = {}
        self.last_request = 0

    def _http(self, method, path, token, body=None):
        # Secrets go through stdin, never argv, environment, files or log output.
        delay = .6 - (time.monotonic() - self.last_request)
        time.sleep(max(0, delay))
        self.last_request = time.monotonic()
        config = ['url = ' + json.dumps(API + path), 'request = ' + json.dumps(method),
                  'header = ' + json.dumps('Authorization: ' + token)]
        if body is not None:
            config += ['header = "Content-Type: application/json"',
                       'data = ' + json.dumps(json.dumps(body, separators=(',', ':')))]
        try:
            result = subprocess.run(['curl', '--config', '-', '--proto', '=https', '-sS',
                                     '--max-time', '20', '-w', '\n%{http_code}',
                                     '-A', USER_AGENT, '-H', 'Platform: pc', '-H', 'Crossplay: true'],
                                    input='\n'.join(config), capture_output=True, text=True, timeout=23)
        except (OSError, subprocess.TimeoutExpired):
            raise ConnectorError('WFM 请求未完成；请重新同步核实，写入不会自动重试。', 502) from None
        if result.returncode:
            raise ConnectorError('无法连接 WFM；请重新同步核实。', 502)
        payload, _, status = result.stdout.rpartition('\n')
        if status == '401':
            raise ConnectorError('WFM 会话无效或已过期，请重新连接。', 401)
        if status == '403':
            raise ConnectorError('WFM 拒绝此操作；请核对账号验证状态和访问权限。', 403)
        if status == '429':
            raise ConnectorError('WFM 请求过于频繁，请稍后再试。', 429)
        if not status.startswith('2'):
            raise ConnectorError('WFM 返回 HTTP ' + status + '；请刷新挂单后核对。', 502)
        try:
            raw = json.loads(payload)
        except ValueError:
            raise ConnectorError('WFM 响应格式异常。', 502) from None
        if not isinstance(raw, dict) or raw.get('error') or 'data' not in raw:
            raise ConnectorError('WFM 没有确认请求成功，请重新同步核实。', 502)
        return raw['data']

    def _call(self, method, path, body=None):
        if not self.token:
            raise ConnectorError('请先在本机连接 WFM 会话。', 401)
        try:
            return self.transport(method, path, self.token, body)
        except ConnectorError as error:
            if error.status == 401:
                self.token = None
                self.user = None
                self.plans.clear()
            raise

    def status(self):
        with self.lock:
            return {'connected': bool(self.token), 'user': copy.deepcopy(self.user), 'csrf': self.csrf}

    def connect(self, value):
        if not isinstance(value, str):
            raise ConnectorError('请在本机输入 WFM Authorization 值。')
        cleaned = value.strip()
        if cleaned.startswith('JWT=') and ';' not in cleaned:
            cleaned = 'JWT ' + cleaned[4:]
        parts = cleaned.split()
        if len(parts) == 1:
            scheme, token = 'Bearer', parts[0]
        elif len(parts) == 2 and parts[0].lower() in ('bearer', 'jwt'):
            scheme, token = ('JWT' if parts[0].lower() == 'jwt' else 'Bearer'), parts[1]
        else:
            raise ConnectorError('请输入 Bearer / JWT Authorization，或单独的 JWT=值；不要粘贴整段 Cookie / curl。')
        if not re.fullmatch(r'[A-Za-z0-9_.~+/=-]{20,8192}', token):
            raise ConnectorError('令牌格式不正确，请勿粘贴 Cookie、密码或整段请求。')
        with self.lock:
            auth = scheme + ' ' + token
            me = self.transport('GET', '/me', auth, None)
            if not isinstance(me, dict) or not isinstance(me.get('id'), str) or not isinstance(me.get('ingameName'), str):
                raise ConnectorError('WFM 未返回有效的本人账号。', 502)
            if me.get('platform') != 'pc' and me.get('crossplay') is not True:
                raise ConnectorError('当前账本仅支持 PC / 跨平台账号。')
            self.token = auth
            self.user = {k: me.get(k) for k in ('id', 'slug', 'ingameName', 'platform', 'crossplay', 'verification')}
            self.plans.clear()
            return {'connected': True, 'user': copy.deepcopy(self.user)}

    def disconnect(self):
        with self.lock:
            self.token = self.user = None
            self.plans.clear()
            return {'connected': False}

    def _orders(self):
        orders = self._call('GET', '/orders/my')
        if not isinstance(orders, list) or len(orders) > 10000:
            raise ConnectorError('WFM 挂单列表格式异常。', 502)
        result = []
        seen = set()
        for order in orders:
            if not isinstance(order, dict) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', str(order.get('id', ''))) or order['id'] in seen:
                raise ConnectorError('WFM 挂单标识异常。', 502)
            if order.get('type') not in ('buy', 'sell') or type(order.get('visible')) is not bool or type(order.get('quantity')) is not int or type(order.get('platinum')) is not int:
                raise ConnectorError('WFM 挂单内容不完整。', 502)
            if not isinstance(order.get('itemId'), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', order['itemId']) or not 1 <= order['quantity'] <= 9999 or not 1 <= order['platinum'] <= 900000:
                raise ConnectorError('WFM 挂单价格、数量或物品标识无效。', 502)
            for key in ('perTrade', 'rank', 'charges', 'amberStars', 'cyanStars'):
                if order.get(key) is not None and (type(order[key]) is not int or order[key] < (1 if key == 'perTrade' else 0) or order[key] > (6 if key == 'perTrade' else 100000)):
                    raise ConnectorError('WFM 挂单变体字段无效。', 502)
            if order.get('subtype') is not None and (not isinstance(order['subtype'], str) or len(order['subtype']) > 100):
                raise ConnectorError('WFM 挂单子类型无效。', 502)
            seen.add(order['id'])
            row = {k: order[k] for k in ORDER_FIELDS if k in order}
            row['revision'] = revision(order)
            result.append(row)
        return result

    def snapshot(self):
        with self.lock:
            orders = self._orders()
            return {'user': copy.deepcopy(self.user), 'orders': orders, 'at': time.time()}

    def plan(self, changes):
        if not isinstance(changes, list) or not 1 <= len(changes) <= 100:
            raise ConnectorError('一次请选择 1–100 条挂单。')
        with self.lock:
            if not self.user or self.user.get('verification') is not True:
                raise ConnectorError('修改挂单需要已验证的 WFM 账号。', 403)
            current = {o['id']: o for o in self._orders()}
            entries, seen = [], set()
            for change in changes:
                if not isinstance(change, dict) or set(change) - {'id', 'revision', 'platinum', 'quantity', 'visible'}:
                    raise ConnectorError('只支持修改价格、数量和显示状态。')
                oid = change.get('id')
                if not isinstance(oid, str) or oid in seen or oid not in current:
                    raise ConnectorError('挂单不存在、重复或不属于当前账号，请重新同步。', 409)
                seen.add(oid)
                old = current[oid]
                if change.get('revision') != old['revision']:
                    raise ConnectorError('挂单已在 WFM 发生变化，请重新同步后操作。', 409)
                patch = {k: change[k] for k in ('platinum', 'quantity', 'visible') if k in change}
                if 'platinum' in patch and (type(patch['platinum']) is not int or not 1 <= patch['platinum'] <= 900000):
                    raise ConnectorError('价格必须为 1–900000 的整数。')
                if 'quantity' in patch and (type(patch['quantity']) is not int or not 1 <= patch['quantity'] <= 9999 or patch['quantity'] % (old.get('perTrade') or 1)):
                    raise ConnectorError('数量必须为 1–9999 的整数，并符合每笔交易份数。')
                if 'visible' in patch and type(patch['visible']) is not bool:
                    raise ConnectorError('显示状态不正确。')
                patch = {k: v for k, v in patch.items() if old.get(k) != v}
                if patch:
                    entries.append({'id': oid, 'before': old, 'patch': patch})
            if not entries:
                raise ConnectorError('没有需要提交的变化。')
            now = time.monotonic()
            self.plans = {k: v for k, v in self.plans.items() if now < v['expires']}
            if len(self.plans) >= 20:
                raise ConnectorError('待确认操作过多，请稍后重试。', 429)
            pid = secrets.token_urlsafe(24)
            self.plans[pid] = {'expires': now + 300, 'userId': self.user['id'], 'entries': entries}
            return {'planId': pid, 'user': copy.deepcopy(self.user), 'entries': copy.deepcopy(entries), 'expiresIn': 300}

    def apply(self, pid):
        with self.lock:
            plan = self.plans.pop(pid, None) if isinstance(pid, str) else None
            if not self.token or not plan or time.monotonic() >= plan['expires'] or plan['userId'] != self.user['id']:
                raise ConnectorError('确认已过期或已经提交，请重新预览。', 409)
            results = []
            for entry in plan['entries']:
                oid, patch = entry['id'], entry['patch']
                try:
                    current = self._call('GET', '/order/' + oid)
                    if not isinstance(current, dict) or revision(current) != entry['before']['revision']:
                        results.append({'id': oid, 'state': 'conflict', 'message': '挂单已变化，未修改；请重新同步。'})
                        continue
                    failure = None
                    try:
                        self._call('PATCH', '/order/' + oid, patch)
                    except ConnectorError as error:
                        failure = error
                    # A timeout does not prove failure. Read back once; never retry a write.
                    actual = self._call('GET', '/order/' + oid)
                    matched = isinstance(actual, dict) and all(actual.get(k) == v for k, v in patch.items())
                    results.append({'id': oid, 'state': 'verified' if matched else 'unconfirmed',
                                    'message': '已回读确认' if matched else str(failure) if failure else '回读与预期不同，请重新同步核实。'})
                    if failure and failure.status in (401, 403, 429):
                        break
                except ConnectorError as error:
                    results.append({'id': oid, 'state': 'unconfirmed', 'message': str(error)})
                    if error.status in (401, 403, 429, 502):
                        break
            attempted = {r['id'] for r in results}
            results += [{'id': e['id'], 'state': 'skipped', 'message': '连接中断或限速，未提交。'} for e in plan['entries'] if e['id'] not in attempted]
            return {'results': results}
