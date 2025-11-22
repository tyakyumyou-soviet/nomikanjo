from django.contrib import admin
from .models import Session, Member, Order, Allocation, HistoryItem

class AllocationInline(admin.TabularInline):
    model = Allocation
    extra = 0

class OrderAdmin(admin.ModelAdmin):
    inlines = [AllocationInline]

admin.site.register(Session)
admin.site.register(Member)
admin.site.register(Order, OrderAdmin)
admin.site.register(Allocation)
admin.site.register(HistoryItem)
