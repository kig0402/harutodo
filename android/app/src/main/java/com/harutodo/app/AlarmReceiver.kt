package com.harutodo.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

class AlarmReceiver : BroadcastReceiver() {
    companion object {
        const val CHANNEL_ID = "haru_task_alarms"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val title = intent.getStringExtra("task_title") ?: "할 일 알림"
        val time = intent.getStringExtra("task_time") ?: ""
        val notifId = intent.getIntExtra("notif_id", System.currentTimeMillis().toInt())

        ensureChannel(context)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                return
            }
        }

        val launchIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPi = PendingIntent.getActivity(
            context,
            notifId,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val contentText = if (time.isNotEmpty()) "$time · $title" else title
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("하루 · 할 일 시간이에요")
            .setContentText(contentText)
            .setStyle(NotificationCompat.BigTextStyle().bigText(contentText))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(contentPi)
            .build()

        NotificationManagerCompat.from(context).notify(notifId, notification)
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
                val ch = NotificationChannel(
                    CHANNEL_ID,
                    "할 일 시간 알림",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "지정한 할 일 시간에 푸시 알림을 보냅니다."
                    enableVibration(true)
                }
                mgr.createNotificationChannel(ch)
            }
        }
    }
}
