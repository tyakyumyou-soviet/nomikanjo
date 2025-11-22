from django.db import models
from decimal import Decimal

class Session(models.Model):
    TAX_CHOICES = [('inclusive','税込'), ('exclusive','税抜')]

    name = models.CharField(max_length=200)
    store_name = models.CharField(max_length=200, blank=True, null=True)
    password = models.CharField(max_length=200, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    lat = models.FloatField(blank=True, null=True)
    lng = models.FloatField(blank=True, null=True)
    tax_mode = models.CharField(max_length=12, choices=TAX_CHOICES, default='inclusive')
    tax_rate = models.PositiveIntegerField(default=10)
    discount_type = models.CharField(max_length=12, default='none')  # none, yen, percent
    discount_value = models.IntegerField(default=0)

    def __str__(self):
        return f"{self.name} ({self.store_name or 'no-store'})"

class Member(models.Model):
    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name='members')
    name = models.CharField(max_length=100)

    def __str__(self):
        return f"{self.name} ({self.session_id})"

class HistoryItem(models.Model):
    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name='history')
    item = models.CharField(max_length=200)
    price = models.IntegerField()

    class Meta:
        ordering = ['-id']

class Order(models.Model):
    session = models.ForeignKey('Session', related_name='orders', on_delete=models.CASCADE)
    item = models.CharField(max_length=200)
    price = models.IntegerField(default=0)  # 価格は整数（円）で保持する想定
    qty = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('1.000'))  # << 変更

    created_at = models.DateTimeField(auto_now_add=True)

class Allocation(models.Model):
    order = models.ForeignKey(Order, related_name='allocations', on_delete=models.CASCADE)
    member = models.ForeignKey('Member', related_name='allocations', on_delete=models.CASCADE)
    qty = models.DecimalField(max_digits=10, decimal_places=6, default=Decimal('0'))  # << 小数を許可（精度高め）
