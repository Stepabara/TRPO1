<?php
session_start();

try {
  $db = new PDO("sqlite:C:/Users/stepa/OneDrive/Desktop/Проект PTYO 2.www.db");
  $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

  $phone = $_POST['phone'];
  $password = $_POST['password'];

  // Проверка клиента
  $stmt = $db->prepare("SELECT * FROM clients WHERE phone = :phone");
  $stmt->bindParam(':phone', $phone);
  $stmt->execute();
  $client = $stmt->fetch(PDO::FETCH_ASSOC);

  if ($client && $password === '1234') { // временная проверка пароля
    $_SESSION['client_id'] = $client['id'];
    header("Location: Личный кабинет.php");
    exit;
  } else {
    echo "❌ Неверный номер или пароль";
  }
} catch (PDOException $e) {
  echo "❌ Ошибка: " . $e->getMessage();
}
?>
