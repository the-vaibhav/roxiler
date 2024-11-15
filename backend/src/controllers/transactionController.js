const axios = require('axios');
const Transaction = require('../models/Transaction');

// creating api to initialize or seed database with data provided by company 
exports.initializeDatabase = async (req, res) => {
    try {
        const response = await axios.get('https://s3.amazonaws.com/roxiler.com/product_transaction.json');
        const transactions = response.data.map(transaction => ({
            ...transaction,
            dateOfSale: new Date(transaction.dateOfSale) // Convert dateOfSale to Date object
        }));

        await Transaction.deleteMany({});
        await Transaction.insertMany(transactions);

        res.status(200).json({ message: 'Database initialized with seed data' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch or initialize data' });
    }
};

exports.listTransactions = async (req, res) => {
  const { search = '', page = 1, perPage = 10, month } = req.query;

  // Set up search criteria for title, description, and price
  const query = {
    $or: [
      { title: { $regex: search, $options: 'i' } }, 
      { description: { $regex: search, $options: 'i' } }, 
    ]
  };

  if (!isNaN(parseFloat(search))) {
    query.$or.push({ price: parseFloat(search) }); // search price if it's a number in the mongo
  }

  //  here if the month is provided, filter the month (ignoring the year)
  if (month) {
    console.log(`Filtering transactions for month: ${month}`);
    
    // im using $expr with $month to compare the month of dateOfSale
    query.$expr = {
      $eq: [{ $month: "$dateOfSale" }, parseInt(month)]  // Ignore year, just compare month
    };
  }

  const skip = (page - 1) * perPage;

  try {
    // Fetch transactions based on the query, with pagination
    const transactions = await Transaction.find(query)
      .skip(skip)
      .limit(Number(perPage));

    // Count the total transactions that match the query
    const total = await Transaction.countDocuments(query);

    console.log(`Found ${transactions.length} transactions for month: ${month}`);

    res.status(200).json({ total, page, perPage, transactions });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions', details: error.message });
  }
};

exports.getStatistics = async (req, res) => {
    const { month } = req.query;

    // Ensure the month is a valid number between 1 and 12
    if (!month || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Invalid month. Please provide a month between 1 and 12.' });
    }

    console.log(`Searching for transactions in month: ${month}`);

    try {
        // Count sold items for the month regardless of year
        const soldItems = await Transaction.countDocuments({
            sold: true,
            $expr: { $eq: [{ $month: "$dateOfSale" }, parseInt(month)] }
        });

        // Count not sold items for the specified month regardless of year
        const notSoldItems = await Transaction.countDocuments({
            sold: false,
            $expr: { $eq: [{ $month: "$dateOfSale" }, parseInt(month)] }
        });

        // Calculate total sale amount for sold items in the specified month regardless of year
        const totalSaleAmount = await Transaction.aggregate([
            {
                $match: {
                    sold: true,
                    $expr: { $eq: [{ $month: "$dateOfSale" }, parseInt(month)] }
                }
            },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: "$price" }
                }
            }
        ]);

        res.status(200).json({
            totalSaleAmount: totalSaleAmount[0]?.totalAmount || 0,
            soldItems,
            notSoldItems
        });
    } catch (error) {
        console.error(error); 
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
};

exports.getBarChartData = async (req, res) => {
    const { month } = req.query;

    if (!month || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Invalid month. Please provide a month between 1 and 12.' });
    }

    const priceRanges = [
        { label: '0-100', min: 0, max: 100 },
        { label: '101-200', min: 101, max: 200 },
        { label: '201-300', min: 201, max: 300 },
        { label: '301-400', min: 301, max: 400 },
        { label: '401-500', min: 401, max: 500 },
        { label: '501-600', min: 501, max: 600 },
        { label: '601-700', min: 601, max: 700 },
        { label: '701-800', min: 701, max: 800 },
        { label: '801-900', min: 801, max: 900 },
        { label: '901-above', min: 901, max: Infinity }
    ];

    try {
        const data = await Promise.all(priceRanges.map(async (range) => {
            const count = await Transaction.countDocuments({
                price: { $gte: range.min, $lt: range.max },
                $expr: { $eq: [{ $month: "$dateOfSale" }, parseInt(month)] }
            });
            return { range: range.label, count };
        }));

        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch bar chart data' });
    }
};

exports.getPieChartData = async (req, res) => {
    const { month } = req.query;

    if (!month || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Invalid month. Please provide a month between 1 and 12.' });
    }

    try {
        const data = await Transaction.aggregate([
            { $match: { $expr: { $eq: [{ $month: "$dateOfSale" }, parseInt(month)] } } },
            { $group: { _id: "$category", count: { $sum: 1 } } }
        ]);

        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch pie chart data' });
    }
};

exports.getAllData = async (req, res) => {
    const { month } = req.query;

    if (!month || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Invalid month. Please provide a month between 1 and 12.' });
    }

    try {
        const statistics = await exports.getStatistics({ query: { month } }, { json: data => data });
        const barChartData = await exports.getBarChartData({ query: { month } }, { json: data => data });
        const pieChartData = await exports.getPieChartData({ query: { month } }, { json: data => data });

        res.status(200).json({
            statistics,
            barChartData,
            pieChartData
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch all data' });
    }
};
