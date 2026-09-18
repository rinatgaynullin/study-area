from django.urls import path

from .views import AudioUploadView, FileUploadView, ImageUploadView

app_name = 'rich_editor'

urlpatterns = [
    path('upload/image/', ImageUploadView.as_view(), name='upload_image'),
    path('upload/audio/', AudioUploadView.as_view(), name='upload_audio'),
    path('upload/file/', FileUploadView.as_view(), name='upload_file'),
]
