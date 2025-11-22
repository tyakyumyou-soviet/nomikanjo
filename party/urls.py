# party/urls.py
from django.urls import path
from . import views

app_name = 'party'  # namespace を使っている場合に必要

urlpatterns = [
    path('', views.home_view, name='home'),
    path('session/<int:session_id>/', views.session_detail_view, name='session_detail'),

    # API
    path('api/sessions/', views.api_sessions, name='api_sessions'),
    path('api/sessions/<int:session_id>/', views.api_session_detail, name='api_session_detail'),
    path('api/sessions/<int:session_id>/check_password/', views.api_check_password, name='api_check_password'),
    path('api/sessions/<int:session_id>/history/', views.api_history, name='api_history'),
    path('api/sessions/<int:session_id>/members/', views.api_members, name='api_members'),
    path('api/sessions/<int:session_id>/orders/', views.api_orders, name='api_orders'),
    path('api/sessions/<int:session_id>/orders/<int:order_id>/', views.api_order_detail, name='api_order_detail'),
    path('api/sessions/<int:session_id>/settings/', views.api_settings, name='api_settings'),
    path('api/sessions/<int:session_id>/receipt/', views.api_receipt_data, name='api_receipt'),
]
