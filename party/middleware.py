# party/middleware.py
from datetime import timedelta
from django.utils import timezone
from django.core.cache import cache
from django.db import OperationalError, ProgrammingError, DatabaseError

CLEANUP_CACHE_KEY = "party_last_cleanup_ts"
CLEANUP_INTERVAL_SECONDS = 60 * 60  # 1時間に1回（必要なら変更）

def _cleanup_old_sessions():
    from .models import Session  # 遅延インポート（マイグレーション前のimportを避ける）
    cutoff = timezone.now() - timedelta(days=3)
    Session.objects.filter(created_at__lt=cutoff).delete()

class AutoCleanupMiddleware:
    """
    各リクエストで自動的に古いセッションを削除する。ただし実行はキャッシュで間引く（例：1時間に1回）。
    DBが準備できていない（migrate未実行など）の場合は例外を握り潰してスキップします。
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # キャッシュにキーが無ければ実行してキャッシュをセット
        if not cache.get(CLEANUP_CACHE_KEY):
            try:
                _cleanup_old_sessions()
                cache.set(CLEANUP_CACHE_KEY, True, CLEANUP_INTERVAL_SECONDS)
            except (OperationalError, ProgrammingError, DatabaseError):
                # マイグレーション未実行やDB接続問題のときはスキップ
                pass
        return self.get_response(request)
