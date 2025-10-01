<?php
$host = "localhost";
$dbname = "www_bd";
$user = "root";
$pass = "";

$conn = new mysqli($host, $user, $pass, $dbname);
if ($conn->connect_error) {
  die("Ошибка подключения: " . $conn->connect_error);
}

$fullName = $_POST['fullName'];
$phone = $_POST['phone'];
$email = $_POST['email'];
$password = password_hash($_POST['password'], PASSWORD_DEFAULT);
$status = $_POST['status'];

$stmt = $conn->prepare("INSERT INTO clients (fullName, phone, email, password, status) VALUES (?, ?, ?, ?, ?)");
$stmt->bind_param("sssss", $fullName, $phone, $email, $password, $status);

if ($stmt->execute()) {
  echo "Регистрация прошла успешно!";
} else {
  echo "Ошибка: " . $stmt->error;
}

$stmt->close();
$conn->close();
?>
