// Menu templates per cuisine. Prices are base EGP for a mid-range place (price level 2);
// the generator scales them by price level. `img` is a dish photo key (public/img/dish-<img>.jpg).
// Tags: veg (vegetarian), spicy, new, best (best seller), share.

const I = (ar, en, price, img, descAr = '', descEn = '', tags = []) => ({ ar, en, price, img, descAr, descEn, tags })

export const MENUS = {
  egyptian: [
    ['الفطار', 'Breakfast', [
      I('فول بالزيت الحار', 'Ful with chili oil', 45, 'ful-medames', 'فول مدمس على نار هادية مع زيت حار وكمون', 'Slow-cooked fava beans, chili oil, cumin', ['veg', 'spicy']),
      I('فول بالطحينة', 'Ful with tahini', 50, 'ful-medames', 'فول مدمس بالطحينة والليمون', 'Fava beans with tahini and lemon', ['veg']),
      I('طعمية محشية', 'Stuffed falafel', 35, 'falafel', 'طعمية خضرا محشية شطة وبصل', 'Green falafel stuffed with chili and onion', ['veg', 'best']),
      I('بيض بالبسطرمة', 'Eggs with basterma', 85, 'omelette', 'بيض بلدي مع بسطرمة مصري', 'Free-range eggs with Egyptian basterma', []),
      I('فطير مشلتت بالعسل والقشطة', 'Feteer with honey & cream', 140, 'feteer', 'فطير فلاحي طبقات بالسمنة البلدي', 'Layered farm pastry, honey and clotted cream', ['veg', 'share']),
    ]],
    ['الأطباق الرئيسية', 'Mains', [
      I('كشري سوبر', 'Koshari super', 75, 'koshari', 'رز وعدس ومكرونة وحمص وصلصة ودقة وبصل مقرمش', 'Rice, lentils, pasta, chickpeas, tomato sauce, crispy onions', ['veg', 'best']),
      I('ملوخية بالأرانب', 'Molokhia with rabbit', 260, 'molokhia', 'ملوخية خضرا بالتقلية مع نص أرنب', 'Jute leaf stew with half a rabbit', []),
      I('فتة لحمة', 'Beef fattah', 240, 'fattah', 'عيش محمص ورز وصلصة خل وتوم ولحمة ضاني', 'Toasted bread, rice, garlic-vinegar sauce, lamb', ['best']),
      I('محشي مشكل', 'Mixed mahshi', 150, 'mahshi', 'كرنب وورق عنب وكوسة وفلفل', 'Cabbage, vine leaves, zucchini and peppers', ['veg']),
      I('حواوشي إسكندراني', 'Alexandrian hawawshi', 110, 'hawawshi', 'عيش بلدي محشي لحمة متبلة بالفلفل', 'Baladi bread stuffed with spiced minced beef', ['spicy']),
      I('كفتة مشوية على الفحم', 'Charcoal kofta', 220, 'kofta', 'ربع كيلو كفتة مع عيش وطحينة وسلطة', '250 g kofta with bread, tahini and salad', []),
    ]],
    ['حلو', 'Desserts', [
      I('أم علي', 'Om Ali', 85, 'om-ali', 'عجين بالحليب والمكسرات من الفرن', 'Baked pastry pudding with milk and nuts', ['veg', 'best']),
      I('بسبوسة بالقشطة', 'Basbousa with cream', 60, 'basbousa', '', '', ['veg']),
    ]],
    ['مشروبات', 'Drinks', [
      I('شاي بالنعناع', 'Mint tea', 25, 'mint-tea', '', '', ['veg']),
      I('عصير قصب', 'Sugarcane juice', 30, 'fresh-juice', '', '', ['veg']),
      I('ليمون نعناع', 'Lemon mint', 45, 'lemonade', '', '', ['veg']),
    ]],
  ],
  levant: [
    ['مقبلات باردة', 'Cold mezze', [
      I('حمص بيروتي', 'Beiruti hummus', 85, 'hummus', 'حمص بالطحينة والكمون وزيت الزيتون', 'Hummus with tahini, cumin and olive oil', ['veg', 'best']),
      I('متبل باذنجان', 'Moutabal', 80, 'baba-ghanoush', 'باذنجان مشوي على الفحم بالطحينة', 'Charred eggplant with tahini', ['veg']),
      I('تبولة', 'Tabbouleh', 75, 'tabbouleh', 'بقدونس وبرغل ناعم وطماطم وليمون', 'Parsley, fine bulgur, tomato, lemon', ['veg']),
      I('فتوش', 'Fattoush', 80, 'fattoush', 'خضار مع خبز محمص ودبس رمان', 'Garden vegetables, toasted bread, pomegranate molasses', ['veg']),
    ]],
    ['مقبلات ساخنة', 'Hot mezze', [
      I('كبة مقلية', 'Fried kibbeh', 110, 'kibbeh', '٤ قطع كبة باللحمة والصنوبر', 'Four kibbeh with beef and pine nuts', ['best']),
      I('فلافل شامية', 'Levantine falafel', 70, 'falafel', '', '', ['veg']),
      I('مناقيش زعتر', 'Zaatar manakish', 65, 'manakish', 'عجينة طازة بالزعتر وزيت الزيتون', 'Fresh dough, zaatar and olive oil', ['veg']),
      I('مناقيش جبنة', 'Cheese manakish', 85, 'manakish', 'جبنة عكاوي وموزاريلا', 'Akkawi and mozzarella', ['veg']),
    ]],
    ['المشاوي', 'Grills', [
      I('شيش طاووق', 'Shish tawook', 210, 'shish-tawook', 'صدور دجاج متبلة بالثوم واللبن', 'Chicken breast marinated in garlic and yogurt', ['best']),
      I('كباب حلبي', 'Aleppo kebab', 260, 'kofta', 'لحمة ضاني مفرومة بالفلفل الحلبي', 'Minced lamb with Aleppo pepper', ['spicy']),
      I('مشكل مشاوي', 'Mixed grill', 420, 'mixed-grill', 'طاووق وكباب وريش لشخصين', 'Tawook, kebab and lamb chops for two', ['share']),
      I('شاورما دجاج عربي', 'Arabi chicken shawarma', 140, 'shawarma', 'مقطعة مع ثومية وبطاطس', 'Cut wrap with garlic sauce and fries', ['best']),
    ]],
    ['حلويات', 'Sweets', [
      I('كنافة نابلسية', 'Nabulsi kunafa', 95, 'kunafa', 'كنافة بالجبنة والقطر', 'Cheese kunafa with syrup', ['veg', 'best']),
      I('بقلاوة مشكلة', 'Mixed baklava', 120, 'baklava', '٢٥٠ جرام', '250 g', ['veg']),
    ]],
    ['مشروبات', 'Drinks', [
      I('ليموناضة بالنعناع', 'Mint lemonade', 50, 'lemonade', '', '', ['veg']),
      I('شاي', 'Tea', 25, 'tea', '', '', ['veg']),
    ]],
  ],
  gulf: [
    ['الأطباق', 'Platters', [
      I('مندي لحم', 'Lamb mandi', 380, 'mandi', 'ربع خروف على رز مندي مدخن', 'Quarter lamb on smoked mandi rice', ['best', 'share']),
      I('مندي دجاج', 'Chicken mandi', 220, 'mandi', 'نص فرخة على رز مندي', 'Half chicken on mandi rice', ['best']),
      I('كبسة دجاج', 'Chicken kabsa', 210, 'kabsa', 'رز بسمتي بالبهارات والمكسرات', 'Spiced basmati with nuts and raisins', []),
      I('مضغوط لحم', 'Lamb madghout', 330, 'kabsa', '', '', []),
      I('صحن مشكل للعائلة', 'Family platter', 950, 'mandi', 'لحم ودجاج ورز لـ ٤ أشخاص', 'Lamb, chicken and rice for four', ['share']),
    ]],
    ['جانبي', 'Sides', [
      I('سلطة دقوس', 'Daqous salad', 40, 'greek-salad', '', '', ['veg', 'spicy']),
      I('شوربة لسان عصفور', 'Orzo soup', 45, 'soup', '', '', []),
    ]],
    ['مشروبات', 'Drinks', [
      I('شاي كرك', 'Karak tea', 40, 'tea', 'شاي بالحليب والهيل', 'Tea with milk and cardamom', ['veg', 'best']),
      I('عصير ليمون', 'Lemon juice', 40, 'lemonade', '', '', ['veg']),
    ]],
  ],
  italian: [
    ['مقبلات', 'Antipasti', [
      I('بروسكيتا طماطم', 'Tomato bruschetta', 120, 'avocado-toast', '', '', ['veg']),
      I('سلطة سيزر', 'Caesar salad', 160, 'caesar-salad', 'خس روماني وبارميزان وصوص سيزر', 'Romaine, parmesan, caesar dressing', []),
      I('شوربة طماطم', 'Tomato soup', 110, 'soup', '', '', ['veg']),
    ]],
    ['بيتزا', 'Pizza', [
      I('مارجريتا', 'Margherita', 210, 'pizza', 'صلصة سان مارزانو وموزاريلا وريحان', 'San Marzano, mozzarella, basil', ['veg', 'best']),
      I('بيبروني', 'Pepperoni', 260, 'pizza', '', '', ['best']),
      I('أربع أجبان', 'Quattro formaggi', 280, 'pizza', '', '', ['veg']),
      I('ديابولا', 'Diavola', 270, 'pizza', 'سجق حار وفلفل', 'Spicy salami and chili', ['spicy']),
    ]],
    ['باستا وريزوتو', 'Pasta & risotto', [
      I('كاربونارا', 'Carbonara', 230, 'pasta', 'سباجيتي وبيض وبانشيتا وبيكورينو', 'Spaghetti, egg, pancetta, pecorino', ['best']),
      I('أرابياتا', 'Arrabbiata', 190, 'pasta', '', '', ['veg', 'spicy']),
      I('لازانيا بولونيز', 'Lasagna bolognese', 250, 'lasagna', '', '', []),
      I('ريزوتو مشروم', 'Mushroom risotto', 260, 'risotto', '', '', ['veg']),
    ]],
    ['حلو', 'Dolci', [
      I('تيراميسو', 'Tiramisu', 140, 'tiramisu', '', '', ['veg', 'best']),
      I('بانا كوتا', 'Panna cotta', 120, 'cheesecake', '', '', ['veg']),
    ]],
    ['مشروبات', 'Drinks', [
      I('إسبريسو', 'Espresso', 55, 'espresso', '', '', ['veg']),
      I('ليموناضة', 'Lemonade', 70, 'lemonade', '', '', ['veg']),
    ]],
  ],
  burger: [
    ['برجر', 'Burgers', [
      I('كلاسيك سماش', 'Classic smash', 190, 'burger', 'قطعتين سماش وجبنة شيدر وصوص البيت', 'Double smash, cheddar, house sauce', ['best']),
      I('برجر مشروم سويس', 'Mushroom swiss', 220, 'burger', '', '', []),
      I('برجر هالابينو', 'Jalapeño burger', 215, 'burger', '', '', ['spicy']),
      I('تشيكن كرسبي', 'Crispy chicken', 180, 'fried-chicken', '', '', ['best']),
      I('برجر نباتي', 'Veggie burger', 170, 'burger', '', '', ['veg', 'new']),
    ]],
    ['جانبي', 'Sides', [
      I('بطاطس مقرمشة', 'Crispy fries', 60, 'fries', '', '', ['veg']),
      I('بطاطس بالجبنة', 'Cheese fries', 90, 'fries', '', '', ['veg', 'best']),
      I('أجنحة باربكيو', 'BBQ wings', 150, 'chicken-wings', '٨ قطع', '8 pieces', ['share']),
      I('هوت دوج', 'Hot dog', 120, 'hot-dog', '', '', []),
    ]],
    ['مشروبات وحلو', 'Shakes & sweets', [
      I('ميلك شيك فانيليا', 'Vanilla shake', 110, 'smoothie', '', '', ['veg']),
      I('كوكيز', 'Cookies', 60, 'cookies', '', '', ['veg']),
    ]],
  ],
  asian: [
    ['سوشي', 'Sushi', [
      I('كاليفورنيا رول', 'California roll', 220, 'sushi', '٨ قطع', '8 pieces', ['best']),
      I('سبايسي تونة', 'Spicy tuna roll', 260, 'sushi', '', '', ['spicy']),
      I('سالمون نيجيري', 'Salmon nigiri', 240, 'sushi', '٤ قطع', '4 pieces', []),
      I('بوكس سوشي للتشارك', 'Sushi sharing box', 750, 'sushi', '٢٤ قطعة مشكلة', '24 mixed pieces', ['share']),
    ]],
    ['أطباق ساخنة', 'Hot dishes', [
      I('رامن دجاج', 'Chicken ramen', 230, 'ramen', 'مرق ٨ ساعات ونودلز وبيض', '8-hour broth, noodles, soft egg', ['best']),
      I('باد تاي', 'Pad thai', 210, 'pad-thai', '', '', ['spicy']),
      I('دامبلينج مقلي', 'Fried dumplings', 160, 'dumplings', '٦ قطع', '6 pieces', ['best']),
      I('رز مقلي بالخضار', 'Vegetable fried rice', 140, 'fried-rice', '', '', ['veg']),
    ]],
    ['مشروبات', 'Drinks', [
      I('ماتشا لاتيه', 'Matcha latte', 95, 'matcha', '', '', ['veg', 'new']),
      I('شاي ياسمين', 'Jasmine tea', 50, 'tea', '', '', ['veg']),
    ]],
  ],
  indian: [
    ['الأطباق', 'Mains', [
      I('بتر تشيكن', 'Butter chicken', 230, 'butter-chicken', '', '', ['best']),
      I('برياني لحم', 'Lamb biryani', 270, 'biryani', '', '', ['spicy', 'best']),
      I('دال مخني', 'Dal makhani', 150, 'soup', '', '', ['veg']),
      I('تشانا ماسالا', 'Chana masala', 140, 'hummus', '', '', ['veg', 'spicy']),
    ]],
    ['خبز وجانبي', 'Breads & sides', [
      I('خبز نان بالثوم', 'Garlic naan', 45, 'naan', '', '', ['veg', 'best']),
      I('سمبوسة', 'Samosa', 70, 'dumplings', '', '', ['veg']),
    ]],
    ['مشروبات', 'Drinks', [
      I('لاسي مانجا', 'Mango lassi', 70, 'smoothie', '', '', ['veg']),
      I('شاي ماسالا', 'Masala chai', 45, 'tea', '', '', ['veg']),
    ]],
  ],
  mexican: [
    ['الأطباق', 'Mains', [
      I('تاكوز دجاج', 'Chicken tacos', 180, 'tacos', '٣ قطع', '3 pieces', ['best']),
      I('تاكوز لحم', 'Beef tacos', 210, 'tacos', '', '', ['spicy']),
      I('بوريتو', 'Burrito', 200, 'burrito', '', '', ['best']),
      I('ناتشوز للتشارك', 'Sharing nachos', 170, 'tacos', '', '', ['veg', 'share']),
    ]],
    ['مشروبات', 'Drinks', [
      I('ليموناضة فراولة', 'Strawberry lemonade', 75, 'lemonade', '', '', ['veg']),
    ]],
  ],
  grill: [
    ['المشويات', 'From the grill', [
      I('ريش ضاني', 'Lamb chops', 420, 'mixed-grill', 'نص كيلو ريش على الفحم', '500 g charcoal lamb chops', ['best']),
      I('كفتة', 'Kofta', 220, 'kofta', '', '', []),
      I('ستيك ريب آي', 'Ribeye steak', 650, 'steak', '٣٠٠ جرام', '300 g', ['best']),
      I('فراخ مشوية', 'Grilled chicken', 210, 'shish-tawook', 'نص فرخة بالتتبيلة', 'Half marinated chicken', []),
      I('صينية مشكل للعيلة', 'Family grill tray', 1100, 'mixed-grill', 'كيلو مشكل وأرز وسلطات', '1 kg mixed grill, rice, salads', ['share']),
    ]],
    ['جانبي', 'Sides', [
      I('طحينة', 'Tahini', 25, 'hummus', '', '', ['veg']),
      I('سلطة خضرا', 'Green salad', 35, 'greek-salad', '', '', ['veg']),
      I('رز بالشعرية', 'Vermicelli rice', 40, 'fried-rice', '', '', ['veg']),
    ]],
    ['مشروبات', 'Drinks', [
      I('مياه معدنية', 'Water', 15, 'lemonade', '', '', ['veg']),
      I('ليمون نعناع', 'Lemon mint', 45, 'lemonade', '', '', ['veg']),
    ]],
  ],
  seafood: [
    ['من البحر', 'From the sea', [
      I('سمك بوري مشوي', 'Grilled mullet', 280, 'grilled-fish', 'بالكيلو، تتبيلة ردة', 'Per kg, bran crust', ['best']),
      I('جمبري مشوي', 'Grilled shrimp', 420, 'shrimp', '', '', ['best']),
      I('كاليماري مقلي', 'Fried calamari', 260, 'calamari', '', '', []),
      I('صينية جمبري بالطاجن', 'Shrimp tajine', 380, 'shrimp', '', '', ['spicy']),
      I('شوربة سي فود', 'Seafood soup', 150, 'soup', '', '', []),
    ]],
    ['جانبي', 'Sides', [
      I('رز صيادية', 'Sayadeya rice', 60, 'fried-rice', '', '', ['veg']),
      I('بابا غنوج', 'Baba ghanoush', 45, 'baba-ghanoush', '', '', ['veg']),
    ]],
    ['مشروبات', 'Drinks', [
      I('ليمون نعناع', 'Lemon mint', 45, 'lemonade', '', '', ['veg']),
    ]],
  ],
  cafe: [
    ['قهوة', 'Coffee', [
      I('إسبريسو', 'Espresso', 55, 'espresso', '', '', ['veg']),
      I('كابتشينو', 'Cappuccino', 80, 'cappuccino', '', '', ['veg', 'best']),
      I('سبانش لاتيه', 'Spanish latte', 95, 'latte', '', '', ['veg', 'best']),
      I('آيس لاتيه', 'Iced latte', 95, 'iced-coffee', '', '', ['veg']),
      I('V60 قهوة مقطرة', 'V60 pour-over', 110, 'espresso', 'محصول إثيوبي', 'Ethiopian single origin', ['veg', 'new']),
      I('ماتشا', 'Matcha', 110, 'matcha', '', '', ['veg']),
    ]],
    ['فطار طول اليوم', 'All-day breakfast', [
      I('أفوكادو توست', 'Avocado toast', 160, 'avocado-toast', 'عيش ساوردو وبيضة بوشيه', 'Sourdough, poached egg', ['veg', 'best']),
      I('بان كيك', 'Pancakes', 140, 'pancakes', '', '', ['veg']),
      I('كرواسون زبدة', 'Butter croissant', 65, 'croissant', '', '', ['veg']),
      I('أومليت بالجبنة', 'Cheese omelette', 120, 'omelette', '', '', ['veg']),
    ]],
    ['حلو', 'Sweets', [
      I('تشيز كيك', 'Cheesecake', 120, 'cheesecake', '', '', ['veg', 'best']),
      I('كيكة شوكولاتة', 'Chocolate cake', 110, 'chocolate-cake', '', '', ['veg']),
      I('كوكيز', 'Cookies', 55, 'cookies', '', '', ['veg']),
    ]],
    ['منعش', 'Refreshers', [
      I('سموذي مانجا', 'Mango smoothie', 95, 'smoothie', '', '', ['veg']),
      I('عصير برتقال فريش', 'Fresh orange', 70, 'fresh-juice', '', '', ['veg']),
    ]],
  ],
  bakery: [
    ['مخبوزات', 'Bakes', [
      I('كرواسون زبدة', 'Butter croissant', 55, 'croissant', '', '', ['veg', 'best']),
      I('كرواسون زعتر وجبنة', 'Zaatar cheese croissant', 70, 'croissant', '', '', ['veg']),
      I('ساندويتش ساوردو', 'Sourdough sandwich', 130, 'sandwich', '', '', []),
      I('دونات', 'Donut', 45, 'donut', '', '', ['veg']),
      I('كريب نوتيلا', 'Nutella crêpe', 95, 'crepe', '', '', ['veg', 'best']),
    ]],
    ['قهوة', 'Coffee', [
      I('لاتيه', 'Latte', 80, 'latte', '', '', ['veg']),
      I('كابتشينو', 'Cappuccino', 75, 'cappuccino', '', '', ['veg']),
    ]],
  ],
  dessert: [
    ['حلويات', 'Desserts', [
      I('كنافة بالقشطة', 'Kunafa with cream', 110, 'kunafa', '', '', ['veg', 'best']),
      I('بقلاوة', 'Baklava', 130, 'baklava', '', '', ['veg']),
      I('وافل نوتيلا', 'Nutella waffle', 120, 'waffles', '', '', ['veg', 'best']),
      I('تشيز كيك لوتس', 'Lotus cheesecake', 130, 'cheesecake', '', '', ['veg', 'new']),
      I('آيس كريم ٣ بولات', 'Ice cream, 3 scoops', 90, 'ice-cream', '', '', ['veg']),
      I('أم علي', 'Om Ali', 85, 'om-ali', '', '', ['veg']),
    ]],
    ['مشروبات', 'Drinks', [
      I('سحلب بالمكسرات', 'Sahlab with nuts', 70, 'sahlab', '', '', ['veg']),
      I('هوت شوكليت', 'Hot chocolate', 80, 'latte', '', '', ['veg']),
    ]],
  ],
  healthy: [
    ['بولز وسلطات', 'Bowls & salads', [
      I('أساي بول', 'Açaí bowl', 170, 'acai-bowl', '', '', ['veg', 'best']),
      I('سلطة يوناني', 'Greek salad', 140, 'greek-salad', '', '', ['veg']),
      I('سيزر دجاج مشوي', 'Grilled chicken caesar', 180, 'caesar-salad', '', '', ['best']),
      I('بول كينوا وسلمون', 'Quinoa salmon bowl', 260, 'sushi', '', '', ['new']),
    ]],
    ['فطار', 'Breakfast', [
      I('أفوكادو توست', 'Avocado toast', 150, 'avocado-toast', '', '', ['veg']),
      I('أومليت بياض', 'Egg-white omelette', 120, 'omelette', '', '', ['veg']),
    ]],
    ['مشروبات', 'Drinks', [
      I('سموذي أخضر', 'Green smoothie', 100, 'smoothie', '', '', ['veg', 'best']),
      I('عصير ديتوكس', 'Detox juice', 90, 'fresh-juice', '', '', ['veg']),
    ]],
  ],
  shisha: [
    ['مشروبات ساخنة', 'Hot drinks', [
      I('شاي كشري', 'Loose-leaf tea', 30, 'tea', '', '', ['veg']),
      I('قهوة تركي', 'Turkish coffee', 40, 'espresso', '', '', ['veg', 'best']),
      I('سحلب', 'Sahlab', 55, 'sahlab', '', '', ['veg']),
      I('نسكافيه', 'Instant coffee', 45, 'cappuccino', '', '', ['veg']),
    ]],
    ['مشروبات باردة', 'Cold drinks', [
      I('ليمون نعناع', 'Lemon mint', 50, 'lemonade', '', '', ['veg', 'best']),
      I('عصير مانجا', 'Mango juice', 60, 'fresh-juice', '', '', ['veg']),
    ]],
    ['سناكس', 'Snacks', [
      I('ساندويتش جبنة رومي', 'Roumi cheese sandwich', 70, 'sandwich', '', '', ['veg']),
      I('بطاطس', 'Fries', 50, 'fries', '', '', ['veg']),
      I('وافل', 'Waffle', 80, 'waffles', '', '', ['veg']),
    ]],
  ],
}
