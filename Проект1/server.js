const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = 3000;

// Актуальные опции подключения к MongoDB
const mongoOptions = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    // Убраны устаревшие опции bufferCommands и bufferMaxEntries
};

// Переменная для отслеживания состояния подключения
let isConnected = false;

// Функция подключения к MongoDB
async function connectToDatabase() {
    try {
        await mongoose.connect('mongodb://localhost:27017/mobile_operator', mongoOptions);
        isConnected = true;
        console.log('✅ Успешное подключение к MongoDB');
        
        // Слушаем события подключения
        mongoose.connection.on('error', (err) => {
            console.error('❌ Ошибка MongoDB:', err);
            isConnected = false;
        });
        
        mongoose.connection.on('disconnected', () => {
            console.log('🔌 MongoDB отключена');
            isConnected = false;
        });
        
        mongoose.connection.on('reconnected', () => {
            console.log('🔁 MongoDB переподключена');
            isConnected = true;
        });
        
    } catch (err) {
        console.error('❌ Ошибка подключения к MongoDB:', err);
        process.exit(1);
    }
}

// Упрощенная схема пользователя БЕЗ EMAIL
const userSchema = new mongoose.Schema({
    fio: { type: String, required: true },
    phone: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'client'], default: 'client', index: true },
    balance: { type: Number, default: 0 },
    tariff: { type: String, default: 'standard' },
    creditLimit: { type: Number, default: 100 },
    status: { type: String, default: 'active' },
    createdAt: { type: Date, default: Date.now }
});

// Создаем индексы для оптимизации запросов
userSchema.index({ phone: 1, role: 1 });
userSchema.index({ balance: 1, status: 1 });

const User = mongoose.model('User', userSchema);

// Функция для получения информации о тарифе
async function getTariffInfo(tariffId) {
    const tariffs = {
        'standard': { id: 'standard', name: 'Базовый', price: 19.99 },
        'premium': { id: 'premium', name: 'Премиум', price: 49.99 },
        'economy': { id: 'economy', name: 'Эконом', price: 9.99 }
    };
    return tariffs[tariffId] || tariffs['standard'];
}

// Middleware для проверки подключения к БД
function checkDatabaseConnection(req, res, next) {
    if (!isConnected) {
        return res.status(503).json({ 
            success: false, 
            message: 'База данных не доступна. Попробуйте позже.' 
        });
    }
    next();
}

// ОБНОВЛЕНИЕ ВСЕХ СУЩЕСТВУЮЩИХ ПОЛЬЗОВАТЕЛЕЙ - ДОБАВЛЯЕМ ПОЛЕ TARIFF
async function updateAllUsersWithTariff() {
    try {
        if (!isConnected) {
            console.log('⏳ Ожидание подключения к БД для обновления пользователей...');
            return;
        }

        console.log('🔄 Проверка и обновление пользователей...');
        
        // Обновляем всех пользователей, у которых нет поля tariff
        const result = await User.updateMany(
            { 
                $or: [
                    { tariff: { $exists: false } },
                    { tariff: null },
                    { tariff: '' }
                ]
            },
            { $set: { tariff: 'standard' } }
        );
        
        console.log(`✅ Обновлено пользователей: ${result.modifiedCount}`);
        console.log(`✅ Совпало пользователей: ${result.matchedCount}`);
        
        // Проверяем сколько всего пользователей и у скольких есть tariff
        const totalUsers = await User.countDocuments();
        const usersWithTariff = await User.countDocuments({ tariff: { $exists: true, $ne: null, $ne: '' } });
        
        console.log(`📊 Всего пользователей: ${totalUsers}`);
        console.log(`📊 Пользователей с тарифом: ${usersWithTariff}`);
        
        // Выводим список всех пользователей для проверки
        const allUsers = await User.find({}).select('fio phone tariff').lean();
        console.log('👥 Список пользователей:');
        allUsers.forEach(user => {
            console.log(`   - ${user.fio} (${user.phone}): тариф = ${user.tariff || 'НЕТ'}`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления пользователей:', error);
    }
}

// Middleware с оптимизацией
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname), {
    maxAge: '1h',
    etag: false
}));

// Кэш для часто запрашиваемых данных
const cache = new Map();
const CACHE_TTL = 60000; // 1 минута

// Middleware для кэширования
function cacheMiddleware(req, res, next) {
    const key = req.originalUrl;
    const cached = cache.get(key);
    
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        return res.json(cached.data);
    }
    
    // Сохраняем оригинальный метод отправки ответа
    const originalJson = res.json;
    res.json = function(data) {
        cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
        originalJson.call(this, data);
    };
    
    next();
}

// Проверка админа
async function checkAdmin() {
    try {
        if (!isConnected) {
            console.log('⏳ Ожидание подключения к БД для проверки администратора...');
            return;
        }

        const adminExists = await User.findOne({ phone: '+375256082909' });
        if (!adminExists) {
            const hashedPassword = await bcrypt.hash('123123', 10);
            await User.create({
                fio: 'Администратор',
                phone: '+375256082909',
                password: hashedPassword,
                role: 'admin',
                tariff: 'standard'
            });
            console.log('✅ Администратор создан');
        } else {
            console.log('✅ Администратор уже существует');
        }
    } catch (error) {
        console.error('Ошибка создания администратора:', error);
    }
}

// Главная страница - авторизация
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Страница админа
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Страница клиента
app.get('/client', (req, res) => {
    res.sendFile(path.join(__dirname, 'client.html'));
});

// API для отладки - проверка данных пользователя
app.get('/api/debug/user', checkDatabaseConnection, async (req, res) => {
    try {
        const { phone } = req.query;
        console.log('🔍 Debug запрос для телефона:', phone);
        
        const user = await User.findOne({ phone }).lean();
        console.log('📊 Найден пользователь:', user);
        
        if (!user) {
            return res.json({ error: 'Пользователь не найден' });
        }
        
        const tariffInfo = await getTariffInfo(user.tariff);
        console.log('💰 Информация о тарифе:', tariffInfo);
        
        res.json({
            user: user,
            tariffInfo: tariffInfo,
            currentTariffId: user.tariff
        });
    } catch (error) {
        console.error('❌ Ошибка debug:', error);
        res.status(500).json({ error: error.message });
    }
});

// API авторизации (БЕЗ EMAIL)
app.post('/api/login', checkDatabaseConnection, async (req, res) => {
    try {
        const { phone, password } = req.body;

        if (!phone || !password) {
            return res.json({ 
                success: false, 
                message: 'Заполните все поля' 
            });
        }

        const user = await User.findOne({ phone }).select('+password').lean();
        if (!user) {
            return res.json({ 
                success: false, 
                message: 'Пользователь не найден' 
            });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.json({ 
                success: false, 
                message: 'Неверный пароль' 
            });
        }

        // Данные пользователя БЕЗ EMAIL
        const tariffInfo = await getTariffInfo(user.tariff);
        
        const userData = {
            fio: user.fio,
            phone: user.phone,
            role: user.role,
            balance: user.balance,
            creditLimit: user.creditLimit,
            status: user.status,
            tariff: tariffInfo
        };

        const redirectUrl = user.role === 'admin' ? '/admin' : '/client';
        
        res.json({ 
            success: true, 
            redirect: redirectUrl,
            user: userData
        });

    } catch (error) {
        console.error('Ошибка авторизации:', error);
        res.json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

// API регистрации (БЕЗ EMAIL)
app.post('/api/register', checkDatabaseConnection, async (req, res) => {
    try {
        const { fio, phone, password } = req.body;

        if (!fio || !phone || !password) {
            return res.json({ 
                success: false, 
                message: 'Заполните обязательные поля' 
            });
        }

        const existingUser = await User.findOne({ phone }).lean();
        if (existingUser) {
            return res.json({ 
                success: false, 
                message: 'Пользователь с таким номером уже существует' 
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            fio,
            phone,
            password: hashedPassword,
            role: 'client',
            tariff: 'standard'
        });

        await newUser.save();

        const tariffInfo = await getTariffInfo(newUser.tariff);

        // Ответ БЕЗ EMAIL
        res.json({ 
            success: true, 
            message: 'Регистрация успешна!',
            redirect: '/client',
            user: {
                fio: newUser.fio,
                phone: newUser.phone,
                role: newUser.role,
                balance: newUser.balance,
                creditLimit: newUser.creditLimit,
                status: newUser.status,
                tariff: tariffInfo
            }
        });

    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.json({ 
            success: false, 
            message: 'Ошибка сервера' 
        });
    }
});

// API для админ-панели с кэшированием
app.get('/api/clients', checkDatabaseConnection, cacheMiddleware, async (req, res) => {
    try {
        const { search } = req.query;
        let filter = { role: 'client' };
        
        if (search) {
            filter.$or = [
                { fio: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }
        
        const clients = await User.find(filter)
            .select('fio phone balance status tariff createdAt')
            .sort({ createdAt: -1 })
            .lean()
            .limit(100);
        
        // Добавляем информацию о тарифе
        const clientsWithTariff = await Promise.all(
            clients.map(async (client) => {
                const tariffInfo = await getTariffInfo(client.tariff);
                return {
                    ...client,
                    tariffInfo: tariffInfo
                };
            })
        );
        
        res.json(clientsWithTariff);
    } catch (error) {
        console.error('Ошибка получения клиентов:', error);
        res.status(500).json({ error: 'Ошибка получения клиентов' });
    }
});

app.get('/api/reports/debtors', checkDatabaseConnection, cacheMiddleware, async (req, res) => {
    try {
        const debtors = await User.find({ 
            role: 'client',
            balance: { $lt: 0 } 
        })
        .select('fio phone balance tariff')
        .sort({ balance: 1 })
        .lean();
        
        // Добавляем информацию о тарифе
        const debtorsWithTariff = await Promise.all(
            debtors.map(async (debtor) => {
                const tariffInfo = await getTariffInfo(debtor.tariff);
                return {
                    ...debtor,
                    tariffInfo: tariffInfo
                };
            })
        );
        
        res.json(debtorsWithTariff);
    } catch (error) {
        console.error('Ошибка формирования отчета:', error);
        res.status(500).json({ error: 'Ошибка формирования отчета' });
    }
});

// Получение данных пользователя (БЕЗ EMAIL)
app.get('/api/user/data', checkDatabaseConnection, async (req, res) => {
    try {
        const { phone } = req.query;
        
        if (!phone) {
            return res.status(400).json({ error: 'Не указан номер телефона' });
        }

        const user = await User.findOne({ phone })
            .select('fio phone balance creditLimit status tariff')
            .lean();
            
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Данные о тарифе из БД
        const tariffInfo = await getTariffInfo(user.tariff);
        
        // Ответ БЕЗ EMAIL
        const responseData = {
            fio: user.fio,
            phone: user.phone,
            balance: user.balance,
            creditLimit: user.creditLimit,
            status: user.status,
            tariff: tariffInfo,
            currentTariffId: user.tariff
        };
        
        res.json(responseData);
    } catch (error) {
        console.error('Ошибка получения данных пользователя:', error);
        res.status(500).json({ error: 'Ошибка получения данных' });
    }
});

// Обновление данных пользователя (БЕЗ EMAIL)
app.put('/api/user/settings', checkDatabaseConnection, async (req, res) => {
    try {
        const { fio, phone } = req.body;
        
        if (!fio || !phone) {
            return res.status(400).json({ error: 'Не заполнены обязательные поля' });
        }
        
        const result = await User.findOneAndUpdate(
            { phone },
            { fio: fio },
            { new: true, runValidators: true }
        ).select('fio phone balance creditLimit status tariff');
        
        if (!result) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        const tariffInfo = await getTariffInfo(result.tariff);
        
        // Очищаем кэш связанных данных
        clearUserCache(phone);
        
        // Ответ БЕЗ EMAIL
        res.json({ 
            success: true, 
            message: 'Настройки сохранены',
            user: {
                fio: result.fio,
                phone: result.phone,
                balance: result.balance,
                creditLimit: result.creditLimit,
                status: result.status,
                tariff: tariffInfo
            }
        });
    } catch (error) {
        console.error('Ошибка сохранения настроек:', error);
        res.status(500).json({ error: 'Ошибка сохранения настроек' });
    }
});

// Пополнение баланса
app.post('/api/payment/topup', checkDatabaseConnection, async (req, res) => {
    try {
        const { phone, amount } = req.body;
        
        if (!phone || !amount || amount <= 0) {
            return res.status(400).json({ error: 'Неверные данные' });
        }
        
        const user = await User.findOneAndUpdate(
            { phone },
            { $inc: { balance: parseFloat(amount) } },
            { new: true }
        ).select('balance tariff');
        
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Очищаем кэш
        clearUserCache(phone);
        
        res.json({ 
            success: true, 
            message: 'Баланс пополнен',
            newBalance: user.balance
        });
    } catch (error) {
        console.error('Ошибка пополнения баланса:', error);
        res.status(500).json({ error: 'Ошибка пополнения баланса' });
    }
});

// API для получения истории звонков (с кэшированием)
app.get('/api/user/calls', checkDatabaseConnection, cacheMiddleware, async (req, res) => {
    try {
        const { phone } = req.query;
        
        const callsHistory = [
            { date: '15.10.2023 14:23', number: '+375 (29) 123-45-67', duration: '5:12', cost: '0.00 ₽' },
            { date: '15.10.2023 12:15', number: '+375 (33) 987-65-43', duration: '2:45', cost: '0.00 ₽' },
            { date: '14.10.2023 18:30', number: '+375 (25) 456-78-90', duration: '10:22', cost: '0.00 ₽' },
            { date: '14.10.2023 09:15', number: '+375 (17) 555-35-35', duration: '3:18', cost: '0.00 ₽' }
        ];
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        res.json(callsHistory);
    } catch (error) {
        console.error('Ошибка получения истории звонков:', error);
        res.status(500).json({ error: 'Ошибка получения истории звонков' });
    }
});

// API для получения истории платежей (с кэшированием)
app.get('/api/user/payments', checkDatabaseConnection, cacheMiddleware, async (req, res) => {
    try {
        const { phone } = req.query;
        
        const paymentsHistory = [
            { date: '10.10.2023', amount: '1000.00 ₽', method: 'Банковская карта', status: 'Успешно' },
            { date: '01.10.2023', amount: '299.00 ₽', method: 'Автоплатеж', status: 'Успешно' },
            { date: '15.09.2023', amount: '500.00 ₽', method: 'ЕРИП', status: 'Успешно' }
        ];
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        res.json(paymentsHistory);
    } catch (error) {
        console.error('Ошибка получения истории платежей:', error);
        res.status(500).json({ error: 'Ошибка получения истории платежей' });
    }
});

// API для получения услуг (с кэшированием)
app.get('/api/user/services', checkDatabaseConnection, cacheMiddleware, async (req, res) => {
    try {
        const { phone } = req.query;
        
        const services = [
            { name: 'Интернет пакет', description: '5 ГБ высокоскоростного интернета', active: true, price: 'Включено' },
            { name: 'Звонки', description: '200 минут на все номера Беларуси', active: true, price: 'Включено' },
            { name: 'Сообщения', description: '50 SMS в месяц', active: true, price: 'Включено' },
            { name: 'Антивирус', description: 'Защита устройства от угроз', active: false, price: '5.99 ₽/мес' },
            { name: 'МТС TV', description: 'Доступ к телеканалам', active: false, price: '9.99 ₽/мес' }
        ];
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        res.json(services);
    } catch (error) {
        console.error('Ошибка получения услуг:', error);
        res.status(500).json({ error: 'Ошибка получения услуг' });
    }
});

// API для получения данных использования (с кэшированием)
app.get('/api/user/usage', checkDatabaseConnection, cacheMiddleware, async (req, res) => {
    try {
        const { phone } = req.query;
        
        const user = await User.findOne({ phone }).lean();
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        const tariffInfo = await getTariffInfo(user.tariff);
        
        const usageData = {
            internet: { used: 2.1, total: 5 },
            calls: { used: 127, total: 200 },
            sms: { used: 23, total: 50 },
            tariff: tariffInfo
        };
        
        await new Promise(resolve => setTimeout(resolve, 150));
        
        res.json(usageData);
    } catch (error) {
        console.error('Ошибка получения данных использования:', error);
        res.status(500).json({ error: 'Ошибка получения данных использования' });
    }
});

// API для управления услугами
app.post('/api/user/services/toggle', checkDatabaseConnection, async (req, res) => {
    try {
        const { phone, serviceName, activate } = req.body;
        
        // Очищаем кэш услуг
        clearUserCache(phone);
        
        res.json({ 
            success: true, 
            message: `Услуга "${serviceName}" ${activate ? 'подключена' : 'отключена'}` 
        });
    } catch (error) {
        console.error('Ошибка управления услугой:', error);
        res.status(500).json({ error: 'Ошибка управления услугой' });
    }
});

// API для смены тарифа
app.post('/api/user/tariff/change', checkDatabaseConnection, async (req, res) => {
    try {
        const { phone, tariffId } = req.body;
        
        // Обновление в базе данных
        const user = await User.findOneAndUpdate(
            { phone },
            { tariff: tariffId },
            { new: true }
        );
        
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Очищаем кэш
        clearUserCache(phone);
        
        res.json({ 
            success: true, 
            message: 'Тариф успешно изменен',
            newTariff: tariffId
        });
    } catch (error) {
        console.error('Ошибка смены тарифа:', error);
        res.status(500).json({ error: 'Ошибка смены тарифа' });
    }
});

// API для получения доступных тарифов (с кэшированием)
app.get('/api/tariffs', checkDatabaseConnection, cacheMiddleware, async (req, res) => {
    try {
        const tariffs = [
            { 
                id: 'standard', 
                name: 'Базовый', 
                price: 19.99, 
                description: '5 ГБ интернета, 200 минут, 50 SMS',
                features: ['5 ГБ интернета', '200 минут', '50 SMS', 'Звонки на номера МТС']
            },
            { 
                id: 'premium', 
                name: 'Премиум', 
                price: 49.99, 
                description: '20 ГБ интернета, 1000 минут, 200 SMS',
                features: ['20 ГБ интернета', '1000 минут', '200 SMS', 'Безлимитные звонки', 'МТС TV']
            },
            { 
                id: 'economy', 
                name: 'Эконом', 
                price: 9.99, 
                description: '2 ГБ интернета, 100 минут, 20 SMS',
                features: ['2 ГБ интернета', '100 минут', '20 SMS', 'Звонки на номера МТС']
            }
        ];
        
        res.json(tariffs);
    } catch (error) {
        console.error('Ошибка получения тарифов:', error);
        res.status(500).json({ error: 'Ошибка получения тарифов' });
    }
});

// API для получения информации о кредитном лимите
app.get('/api/user/credit-info', checkDatabaseConnection, async (req, res) => {
    try {
        const { phone } = req.query;
        
        if (!phone) {
            return res.status(400).json({ error: 'Не указан номер телефона' });
        }
        
        const user = await User.findOne({ phone })
            .select('balance creditLimit tariff')
            .lean();
            
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        const availableCredit = Math.max(0, user.creditLimit + user.balance);
        const tariffInfo = await getTariffInfo(user.tariff);
        
        res.json({
            currentBalance: user.balance,
            creditLimit: user.creditLimit,
            availableCredit: availableCredit,
            isInDebt: user.balance < 0,
            tariff: tariffInfo
        });
    } catch (error) {
        console.error('Ошибка получения информации о кредите:', error);
        res.status(500).json({ error: 'Ошибка получения информации о кредите' });
    }
});

// API для получения уведомлений (с кэшированием)
app.get('/api/user/notifications', checkDatabaseConnection, cacheMiddleware, async (req, res) => {
    try {
        const { phone } = req.query;
        
        const notifications = [
            {
                id: 1,
                type: 'info',
                title: 'Обновление тарифов',
                message: 'С 1 ноября вводятся новые тарифные планы',
                date: '2023-10-20',
                read: false
            },
            {
                id: 2,
                type: 'warning',
                title: 'Заканчивается пакет интернета',
                message: 'Осталось 0.5 ГБ из 5 ГБ',
                date: '2023-10-18',
                read: true
            }
        ];
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        res.json(notifications);
    } catch (error) {
        console.error('Ошибка получения уведомлений:', error);
        res.status(500).json({ error: 'Ошибка получения уведомлений' });
    }
});

// Функция для очистки кэша пользователя
function clearUserCache(phone) {
    const keysToDelete = [];
    for (let key of cache.keys()) {
        if (key.includes(phone)) {
            keysToDelete.push(key);
        }
    }
    
    keysToDelete.forEach(key => cache.delete(key));
}

// Middleware для обработки ошибок
app.use((error, req, res, next) => {
    console.error('Необработанная ошибка:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// Обработка 404
app.use((req, res) => {
    res.status(404).json({ error: 'Маршрут не найден' });
});

// Инициализация при запуске
async function initializeApp() {
    try {
        // Сначала подключаемся к базе данных
        await connectToDatabase();
        
        // Затем выполняем инициализационные задачи
        await checkAdmin();
        await updateAllUsersWithTariff();
        
        // Запуск сервера
        app.listen(PORT, () => {
            console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
            console.log(`📊 MongoDB подключена`);
            console.log(`⚡ Режим оптимизации: ВКЛЮЧЕН`);
            console.log(`📱 Система тарифов: АКТИВИРОВАНА`);
        });
    } catch (error) {
        console.error('❌ Ошибка инициализации приложения:', error);
        process.exit(1);
    }
}

// Запуск приложения
initializeApp();

// Обработка graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Завершение работы сервера...');
    await mongoose.connection.close();
    console.log('✅ MongoDB отключена');
    process.exit(0);
});