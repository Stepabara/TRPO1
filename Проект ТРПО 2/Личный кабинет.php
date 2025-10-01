<?php
session_start();
$username = $_SESSION['username'] ?? 'Гость';
?>

<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Личный кабинет</title>
</head>
<body style="background:#111;color:#eee;font-family:sans-serif;padding:40px;">
  <h2>👤 Добро пожаловать, <?php echo htmlspecialchars($username); ?>!</h2>
  <p>Вы успешно зарегистрированы и вошли в систему.</p>
</body>
</html>
