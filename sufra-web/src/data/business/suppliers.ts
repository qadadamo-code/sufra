/**
 * SAMPLE supplier marketplace — 25 fictional Cairo suppliers and ~250 products.
 * Names are invented; prices are realistic 2026 Cairo wholesale prices in integer piastres, before VAT.
 * VAT: fresh produce, meat, fish, eggs and plain milk are exempt (0%); everything processed or non-food is 14%.
 *
 * Products are built from per-category templates; each supplier carries a deterministic subset with its own
 * price (±8%), stock and minimum order, so the same item can be compared across suppliers.
 */
import { egp } from "./plans";

export type SupplyCategory = "produce" | "meat" | "fish" | "dairy" | "dry" | "drinks" | "packaging" | "cleaning" | "equipment";

export const CATEGORIES: { id: SupplyCategory; ar: string; en: string; icon: string }[] = [
  { id: "produce", ar: "خضار وفاكهة", en: "Fruit & veg", icon: "Carrot" },
  { id: "meat", ar: "لحوم ودواجن", en: "Meat & poultry", icon: "Beef" },
  { id: "fish", ar: "أسماك", en: "Fish & seafood", icon: "Fish" },
  { id: "dairy", ar: "ألبان", en: "Dairy & eggs", icon: "Milk" },
  { id: "dry", ar: "بقالة جافة", en: "Dry grocery", icon: "Wheat" },
  { id: "drinks", ar: "مشروبات", en: "Beverages", icon: "CupSoda" },
  { id: "packaging", ar: "تغليف", en: "Packaging", icon: "Package" },
  { id: "cleaning", ar: "منظفات", en: "Cleaning", icon: "SprayCan" },
  { id: "equipment", ar: "معدات", en: "Equipment", icon: "CookingPot" },
];

export interface Unit {
  ar: string;
  en: string;
}
const U = {
  kg: { ar: "كيلو", en: "kg" },
  carton: { ar: "كرتونة", en: "carton" },
  sack25: { ar: "شيكارة 25 كجم", en: "25 kg sack" },
  sack50: { ar: "شيكارة 50 كجم", en: "50 kg sack" },
  jerry20: { ar: "جركن 20 لتر", en: "20 L jerrycan" },
  jerry5: { ar: "جركن 5 لتر", en: "5 L jerrycan" },
  crate: { ar: "قفص", en: "crate" },
  bunch: { ar: "ربطة", en: "bunch" },
  tray: { ar: "طبق", en: "tray" },
  bucket: { ar: "جردل", en: "bucket" },
  tin: { ar: "صفيحة", en: "tin" },
  piece: { ar: "قطعة", en: "piece" },
  roll: { ar: "رول", en: "roll" },
  box: { ar: "علبة", en: "box" },
  bottle: { ar: "زجاجة", en: "bottle" },
  pack: { ar: "باكيت", en: "pack" },
} satisfies Record<string, Unit>;

interface Template {
  key: string;
  ar: string;
  en: string;
  unit: Unit;
  /** pack size text */
  packAr: string;
  packEn: string;
  /** price per unit, EGP */
  price: number;
  vat: 0 | 14;
  img?: string;
}

const T: Record<SupplyCategory, Template[]> = {
  produce: [
    { key: "tomato", ar: "طماطم", en: "Tomatoes", unit: U.crate, packAr: "قفص 20 كجم", packEn: "20 kg crate", price: 340, vat: 0 },
    { key: "onion", ar: "بصل أحمر", en: "Red onions", unit: U.sack25, packAr: "شيكارة 25 كجم", packEn: "25 kg sack", price: 450, vat: 0 },
    { key: "potato", ar: "بطاطس", en: "Potatoes", unit: U.sack25, packAr: "شيكارة 25 كجم", packEn: "25 kg sack", price: 425, vat: 0, img: "dish-fries" },
    { key: "cucumber", ar: "خيار", en: "Cucumbers", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 22, vat: 0 },
    { key: "pepper", ar: "فلفل رومي ألوان", en: "Bell peppers, mixed", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 60, vat: 0 },
    { key: "lettuce", ar: "خس بلدي", en: "Romaine lettuce", unit: U.carton, packAr: "كرتونة 12 رأس", packEn: "12 heads", price: 150, vat: 0, img: "dish-caesar-salad" },
    { key: "lemon", ar: "ليمون بلدي", en: "Baladi lemons", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 45, vat: 0, img: "dish-lemonade" },
    { key: "garlic", ar: "ثوم بلدي", en: "Garlic", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 95, vat: 0 },
    { key: "carrot", ar: "جزر", en: "Carrots", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 15, vat: 0 },
    { key: "zucchini", ar: "كوسة", en: "Zucchini", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 25, vat: 0, img: "dish-mahshi" },
    { key: "eggplant", ar: "باذنجان رومي", en: "Eggplant", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 18, vat: 0, img: "dish-baba-ghanoush" },
    { key: "parsley", ar: "بقدونس", en: "Parsley", unit: U.bunch, packAr: "10 ربطات", packEn: "10 bunches", price: 40, vat: 0, img: "dish-tabbouleh" },
    { key: "mint", ar: "نعناع", en: "Fresh mint", unit: U.bunch, packAr: "10 ربطات", packEn: "10 bunches", price: 50, vat: 0, img: "dish-mint-tea" },
    { key: "mushroom", ar: "مشروم أبيض", en: "White mushrooms", unit: U.carton, packAr: "كرتونة 2 كجم", packEn: "2 kg box", price: 260, vat: 0 },
    { key: "avocado", ar: "أفوكادو", en: "Avocado", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 160, vat: 0, img: "dish-avocado-toast" },
    { key: "strawberry", ar: "فراولة", en: "Strawberries", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 50, vat: 0, img: "dish-smoothie" },
    { key: "banana", ar: "موز", en: "Bananas", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 35, vat: 0 },
    { key: "orange", ar: "برتقال عصير", en: "Juicing oranges", unit: U.crate, packAr: "قفص 15 كجم", packEn: "15 kg crate", price: 240, vat: 0, img: "dish-fresh-juice" },
    { key: "mango", ar: "مانجو عويس", en: "Awees mango", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 70, vat: 0 },
    { key: "molokhia", ar: "ملوخية خضرا", en: "Fresh molokhia", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 30, vat: 0, img: "dish-molokhia" },
    { key: "chili", ar: "فلفل حامي", en: "Hot chillies", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 40, vat: 0 },
    { key: "cabbage", ar: "كرنب", en: "Cabbage", unit: U.piece, packAr: "بالرأس", packEn: "per head", price: 20, vat: 0 },
  ],
  meat: [
    { key: "beef-topside", ar: "لحم بقري كندوز", en: "Beef topside", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 420, vat: 0, img: "dish-steak" },
    { key: "beef-mince", ar: "لحم مفروم بلدي", en: "Minced beef", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 390, vat: 0, img: "dish-kofta" },
    { key: "beef-fillet", ar: "فيليه بقري", en: "Beef tenderloin", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 650, vat: 0, img: "dish-steak" },
    { key: "lamb", ar: "لحم ضاني", en: "Lamb", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 480, vat: 0, img: "dish-mixed-grill" },
    { key: "chicken-whole", ar: "فراخ بيضاء كاملة", en: "Whole chicken", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 95, vat: 0, img: "dish-fried-chicken" },
    { key: "chicken-breast", ar: "صدور فراخ فيليه", en: "Chicken breast fillet", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 210, vat: 0, img: "dish-shish-tawook" },
    { key: "chicken-thigh", ar: "أوراك فراخ", en: "Chicken thighs", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 115, vat: 0, img: "dish-chicken-wings" },
    { key: "chicken-liver", ar: "كبدة فراخ", en: "Chicken livers", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 120, vat: 0 },
    { key: "sausage", ar: "سجق شرقي", en: "Oriental sausage", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 320, vat: 14, img: "dish-hawawshi" },
    { key: "pastrami", ar: "بسطرمة", en: "Pastirma", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 600, vat: 14 },
    { key: "burger-patty", ar: "برجر بقري مجمد 150 جم", en: "Frozen beef patties 150 g", unit: U.carton, packAr: "كرتونة 40 قطعة", packEn: "40 pieces", price: 1650, vat: 14, img: "dish-burger" },
    { key: "shawarma-meat", ar: "لحم شاورما متبل", en: "Marinated shawarma beef", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 410, vat: 14, img: "dish-shawarma" },
    { key: "turkey", ar: "شرائح ديك رومي مدخن", en: "Smoked turkey slices", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 380, vat: 14, img: "dish-sandwich" },
    { key: "duck", ar: "بط مسكوفي", en: "Muscovy duck", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 170, vat: 0 },
  ],
  fish: [
    { key: "tilapia", ar: "بلطي", en: "Tilapia", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 85, vat: 0, img: "dish-grilled-fish" },
    { key: "mullet", ar: "بوري", en: "Mullet", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 180, vat: 0, img: "dish-grilled-fish" },
    { key: "seabass", ar: "قاروص", en: "Sea bass", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 380, vat: 0, img: "dish-grilled-fish" },
    { key: "shrimp-m", ar: "جمبري وسط", en: "Medium shrimp", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 520, vat: 0, img: "dish-shrimp" },
    { key: "shrimp-j", ar: "جمبري جامبو", en: "Jumbo shrimp", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 850, vat: 0, img: "dish-shrimp" },
    { key: "calamari", ar: "كاليماري حلقات مجمد", en: "Frozen calamari rings", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 320, vat: 14, img: "dish-calamari" },
    { key: "salmon", ar: "سالمون فيليه نرويجي", en: "Norwegian salmon fillet", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 1450, vat: 14, img: "dish-sushi" },
    { key: "tilapia-fillet", ar: "فيليه بلطي مجمد", en: "Frozen tilapia fillet", unit: U.carton, packAr: "كرتونة 10 كجم", packEn: "10 kg carton", price: 1900, vat: 14 },
    { key: "tuna", ar: "تونة قطع 185 جم", en: "Tuna chunks 185 g", unit: U.carton, packAr: "كرتونة 48 علبة", packEn: "48 tins", price: 2200, vat: 14 },
    { key: "sardine", ar: "سردين طازة", en: "Fresh sardines", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 90, vat: 0 },
    { key: "crab", ar: "كابوريا", en: "Blue crab", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 280, vat: 0 },
    { key: "sole", ar: "موسى فيليه", en: "Sole fillet", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 460, vat: 0 },
  ],
  dairy: [
    { key: "milk", ar: "لبن كامل الدسم 1 لتر", en: "Full-cream milk 1 L", unit: U.carton, packAr: "كرتونة 12 لتر", packEn: "12 × 1 L", price: 540, vat: 0, img: "dish-latte" },
    { key: "feta", ar: "جبنة فيتا", en: "Feta cheese", unit: U.bucket, packAr: "جردل 10 كجم", packEn: "10 kg tub", price: 1350, vat: 14, img: "dish-greek-salad" },
    { key: "mozzarella", ar: "جبنة موتزاريلا", en: "Mozzarella", unit: U.kg, packAr: "بلوك 2.5 كجم", packEn: "2.5 kg block", price: 280, vat: 14, img: "dish-pizza" },
    { key: "cheddar", ar: "جبنة شيدر", en: "Cheddar", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 340, vat: 14 },
    { key: "roumi", ar: "جبنة رومي", en: "Roumi cheese", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 380, vat: 14 },
    { key: "butter", ar: "زبدة بلدي", en: "Butter", unit: U.carton, packAr: "كرتونة 10 كجم", packEn: "10 kg", price: 2700, vat: 14, img: "dish-croissant" },
    { key: "cooking-cream", ar: "كريمة طبخ", en: "Cooking cream", unit: U.carton, packAr: "كرتونة 12 × 1 لتر", packEn: "12 × 1 L", price: 1450, vat: 14, img: "dish-pasta" },
    { key: "whipping", ar: "كريمة خفق", en: "Whipping cream", unit: U.carton, packAr: "كرتونة 12 × 1 لتر", packEn: "12 × 1 L", price: 1750, vat: 14, img: "dish-cheesecake" },
    { key: "yogurt", ar: "زبادي 105 جم", en: "Yogurt 105 g", unit: U.carton, packAr: "كرتونة 24 علبة", packEn: "24 cups", price: 192, vat: 0 },
    { key: "eggs", ar: "بيض أبيض", en: "White eggs", unit: U.tray, packAr: "كرتونة 30 بيضة", packEn: "30 eggs", price: 165, vat: 0, img: "dish-omelette" },
    { key: "labneh", ar: "لبنة", en: "Labneh", unit: U.bucket, packAr: "جردل 5 كجم", packEn: "5 kg tub", price: 420, vat: 14 },
    { key: "cream-cheese", ar: "جبنة كريمي", en: "Cream cheese", unit: U.kg, packAr: "بلوك 1 كجم", packEn: "1 kg block", price: 290, vat: 14, img: "dish-cheesecake" },
    { key: "parmesan", ar: "بارميزان مبشور", en: "Grated parmesan", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 890, vat: 14, img: "dish-risotto" },
  ],
  dry: [
    { key: "rice", ar: "أرز مصري", en: "Egyptian rice", unit: U.sack25, packAr: "شيكارة 25 كجم", packEn: "25 kg sack", price: 850, vat: 14, img: "dish-koshari" },
    { key: "basmati", ar: "أرز بسمتي", en: "Basmati rice", unit: U.sack25, packAr: "شيكارة 25 كجم", packEn: "25 kg sack", price: 2250, vat: 14, img: "dish-biryani" },
    { key: "pasta", ar: "مكرونة 400 جم", en: "Pasta 400 g", unit: U.carton, packAr: "كرتونة 20 كيس", packEn: "20 packs", price: 360, vat: 14, img: "dish-pasta" },
    { key: "flour", ar: "دقيق فاخر", en: "Premium flour", unit: U.sack50, packAr: "شيكارة 50 كجم", packEn: "50 kg sack", price: 1350, vat: 14, img: "dish-feteer" },
    { key: "sugar", ar: "سكر أبيض", en: "White sugar", unit: U.sack50, packAr: "شيكارة 50 كجم", packEn: "50 kg sack", price: 1700, vat: 14 },
    { key: "sunflower", ar: "زيت عباد الشمس", en: "Sunflower oil", unit: U.jerry20, packAr: "جركن 20 لتر", packEn: "20 L", price: 1550, vat: 14 },
    { key: "olive-oil", ar: "زيت زيتون بكر", en: "Extra-virgin olive oil", unit: U.jerry5, packAr: "جركن 5 لتر", packEn: "5 L", price: 1600, vat: 14 },
    { key: "ghee", ar: "سمن نباتي", en: "Vegetable ghee", unit: U.tin, packAr: "صفيحة 16 كجم", packEn: "16 kg tin", price: 1450, vat: 14 },
    { key: "lentils", ar: "عدس أصفر", en: "Yellow lentils", unit: U.sack25, packAr: "شيكارة 25 كجم", packEn: "25 kg sack", price: 1175, vat: 14, img: "dish-soup" },
    { key: "fava", ar: "فول مدمس", en: "Fava beans", unit: U.sack25, packAr: "شيكارة 25 كجم", packEn: "25 kg sack", price: 1000, vat: 14, img: "dish-ful-medames" },
    { key: "chickpeas", ar: "حمص الشام", en: "Chickpeas", unit: U.sack25, packAr: "شيكارة 25 كجم", packEn: "25 kg sack", price: 1375, vat: 14, img: "dish-hummus" },
    { key: "tahini", ar: "طحينة", en: "Tahini", unit: U.bucket, packAr: "جردل 10 كجم", packEn: "10 kg tub", price: 1350, vat: 14, img: "dish-hummus" },
    { key: "tomato-paste", ar: "صلصة طماطم 360 جم", en: "Tomato paste 360 g", unit: U.carton, packAr: "كرتونة 24 علبة", packEn: "24 tins", price: 650, vat: 14 },
    { key: "salt", ar: "ملح طعام", en: "Table salt", unit: U.carton, packAr: "كرتونة 25 كيس كيلو", packEn: "25 × 1 kg", price: 175, vat: 14 },
    { key: "cumin", ar: "كمون مطحون", en: "Ground cumin", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 380, vat: 14 },
    { key: "black-pepper", ar: "فلفل أسود", en: "Black pepper", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 520, vat: 14 },
    { key: "yeast", ar: "خميرة فورية 500 جم", en: "Instant yeast 500 g", unit: U.carton, packAr: "كرتونة 20 كيس", packEn: "20 packs", price: 1700, vat: 14 },
    { key: "vermicelli", ar: "شعرية", en: "Vermicelli", unit: U.carton, packAr: "كرتونة 20 كيس", packEn: "20 packs", price: 330, vat: 14 },
    { key: "chocolate", ar: "شوكولاتة طبخ داكنة", en: "Dark cooking chocolate", unit: U.kg, packAr: "بلوك 2.5 كجم", packEn: "2.5 kg block", price: 640, vat: 14, img: "dish-chocolate-cake" },
    { key: "nuts", ar: "مكسرات مشكلة", en: "Mixed nuts", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 720, vat: 14, img: "dish-baklava" },
    { key: "semolina", ar: "سميد", en: "Semolina", unit: U.sack25, packAr: "شيكارة 25 كجم", packEn: "25 kg sack", price: 900, vat: 14, img: "dish-basbousa" },
    { key: "kunafa", ar: "كنافة شعر", en: "Kunafa dough", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 70, vat: 14, img: "dish-kunafa" },
  ],
  drinks: [
    { key: "water-small", ar: "مياه معدنية 600 مل", en: "Mineral water 600 ml", unit: U.carton, packAr: "كرتونة 24 زجاجة", packEn: "24 bottles", price: 115, vat: 14 },
    { key: "water-big", ar: "مياه معدنية 1.5 لتر", en: "Mineral water 1.5 L", unit: U.carton, packAr: "كرتونة 12 زجاجة", packEn: "12 bottles", price: 105, vat: 14 },
    { key: "cola", ar: "مشروب غازي كانز 330 مل", en: "Cola cans 330 ml", unit: U.carton, packAr: "كرتونة 24 كانز", packEn: "24 cans", price: 380, vat: 14 },
    { key: "juice", ar: "عصير برتقال 1 لتر", en: "Orange juice 1 L", unit: U.carton, packAr: "كرتونة 12", packEn: "12 × 1 L", price: 480, vat: 14, img: "dish-fresh-juice" },
    { key: "beans-brazil", ar: "بن برازيلي محمص", en: "Brazilian roasted beans", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 850, vat: 14, img: "dish-espresso" },
    { key: "espresso-blend", ar: "بلند إسبريسو", en: "Espresso blend", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 1100, vat: 14, img: "dish-cappuccino" },
    { key: "turkish", ar: "بن تركي محوج", en: "Turkish coffee w/ cardamom", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 780, vat: 14 },
    { key: "tea-loose", ar: "شاي ناعم", en: "Loose black tea", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 260, vat: 14, img: "dish-tea" },
    { key: "tea-bags", ar: "شاي فتلة 100 كيس", en: "Tea bags ×100", unit: U.carton, packAr: "كرتونة 24 علبة", packEn: "24 boxes", price: 1900, vat: 14, img: "dish-tea" },
    { key: "syrup", ar: "سيروب فانيليا 750 مل", en: "Vanilla syrup 750 ml", unit: U.bottle, packAr: "زجاجة", packEn: "bottle", price: 420, vat: 14, img: "dish-iced-coffee" },
    { key: "oat-milk", ar: "حليب شوفان 1 لتر", en: "Oat milk 1 L", unit: U.carton, packAr: "كرتونة 6", packEn: "6 × 1 L", price: 720, vat: 14, img: "dish-matcha" },
    { key: "matcha", ar: "ماتشا 100 جم", en: "Matcha 100 g", unit: U.box, packAr: "علبة", packEn: "tin", price: 650, vat: 14, img: "dish-matcha" },
    { key: "sahlab", ar: "سحلب بودرة", en: "Sahlab powder", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 240, vat: 14, img: "dish-sahlab" },
    { key: "hibiscus", ar: "كركديه أسواني", en: "Aswan hibiscus", unit: U.kg, packAr: "بالكيلو", packEn: "per kg", price: 190, vat: 14 },
  ],
  packaging: [
    { key: "alu-8389", ar: "علب ألومنيوم 8389", en: "Aluminium trays 8389", unit: U.carton, packAr: "كرتونة 1000", packEn: "1,000 pcs", price: 1500, vat: 14 },
    { key: "micro-1000", ar: "علب ميكروويف 1000 مل", en: "Microwave tubs 1,000 ml", unit: U.carton, packAr: "كرتونة 300", packEn: "300 pcs", price: 900, vat: 14 },
    { key: "kraft-bags", ar: "أكياس ورق كرافت", en: "Kraft paper bags", unit: U.carton, packAr: "كرتونة 500", packEn: "500 pcs", price: 750, vat: 14 },
    { key: "cups-8", ar: "أكواب ورق 8 أونص", en: "Paper cups 8 oz", unit: U.carton, packAr: "كرتونة 1000", packEn: "1,000 pcs", price: 1100, vat: 14 },
    { key: "lids", ar: "أغطية أكواب", en: "Cup lids", unit: U.carton, packAr: "كرتونة 1000", packEn: "1,000 pcs", price: 450, vat: 14 },
    { key: "cutlery", ar: "أدوات أكل خشب", en: "Wooden cutlery sets", unit: U.carton, packAr: "كرتونة 1000", packEn: "1,000 sets", price: 600, vat: 14 },
    { key: "napkins", ar: "مناديل سفرة", en: "Table napkins", unit: U.carton, packAr: "كرتونة 40 باكو", packEn: "40 packs", price: 380, vat: 14 },
    { key: "stretch", ar: "رول استرتش 45 سم", en: "Cling film 45 cm", unit: U.roll, packAr: "رول", packEn: "roll", price: 220, vat: 14 },
    { key: "pizza-box", ar: "علب بيتزا 30 سم", en: "Pizza boxes 30 cm", unit: U.carton, packAr: "100 علبة", packEn: "100 boxes", price: 550, vat: 14, img: "dish-pizza" },
    { key: "burger-box", ar: "علب برجر كرتون", en: "Burger clamshells", unit: U.carton, packAr: "كرتونة 500", packEn: "500 pcs", price: 1050, vat: 14, img: "dish-burger" },
    { key: "foil", ar: "ورق ألومنيوم 45 سم", en: "Aluminium foil 45 cm", unit: U.roll, packAr: "رول 1.5 كجم", packEn: "1.5 kg roll", price: 480, vat: 14 },
    { key: "sauce-cups", ar: "علب صوص 2 أونص", en: "Sauce cups 2 oz", unit: U.carton, packAr: "كرتونة 2500", packEn: "2,500 pcs", price: 700, vat: 14 },
  ],
  cleaning: [
    { key: "disinfect", ar: "مطهر عام", en: "Disinfectant", unit: U.jerry20, packAr: "جركن 20 لتر", packEn: "20 L", price: 750, vat: 14 },
    { key: "dish", ar: "سائل غسيل أطباق", en: "Dishwashing liquid", unit: U.jerry20, packAr: "جركن 20 لتر", packEn: "20 L", price: 650, vat: 14 },
    { key: "bleach", ar: "كلور", en: "Bleach", unit: U.jerry20, packAr: "جركن 20 لتر", packEn: "20 L", price: 280, vat: 14 },
    { key: "floor", ar: "منظف أرضيات", en: "Floor cleaner", unit: U.jerry20, packAr: "جركن 20 لتر", packEn: "20 L", price: 600, vat: 14 },
    { key: "degreaser", ar: "مزيل دهون قوي", en: "Heavy degreaser", unit: U.jerry5, packAr: "جركن 5 لتر", packEn: "5 L", price: 450, vat: 14 },
    { key: "gloves", ar: "قفازات نيتريل", en: "Nitrile gloves", unit: U.box, packAr: "علبة 100", packEn: "box of 100", price: 260, vat: 14 },
    { key: "kitchen-roll", ar: "رول مطبخ", en: "Kitchen towel rolls", unit: U.carton, packAr: "كرتونة 24 رول", packEn: "24 rolls", price: 600, vat: 14 },
    { key: "bin-bags", ar: "أكياس قمامة كبيرة", en: "Large bin bags", unit: U.carton, packAr: "كرتونة 10 رول", packEn: "10 rolls", price: 520, vat: 14 },
    { key: "sanitizer", ar: "معقم أيدي", en: "Hand sanitiser", unit: U.jerry5, packAr: "جركن 5 لتر", packEn: "5 L", price: 550, vat: 14 },
    { key: "steel-polish", ar: "ملمع ستانلس 500 مل", en: "Stainless polish 500 ml", unit: U.carton, packAr: "كرتونة 6", packEn: "6 cans", price: 540, vat: 14 },
    { key: "rinse", ar: "ملمع غسالة أطباق", en: "Dishwasher rinse aid", unit: U.jerry5, packAr: "جركن 5 لتر", packEn: "5 L", price: 690, vat: 14 },
    { key: "sponges", ar: "سلك وإسفنج", en: "Scourers & sponges", unit: U.pack, packAr: "باكيت 50", packEn: "pack of 50", price: 240, vat: 14 },
  ],
  equipment: [
    { key: "pan", ar: "طاسة تيفال 32 سم", en: "Non-stick pan 32 cm", unit: U.piece, packAr: "قطعة", packEn: "piece", price: 1200, vat: 14 },
    { key: "knife", ar: "سكينة شيف 20 سم", en: "Chef's knife 20 cm", unit: U.piece, packAr: "قطعة", packEn: "piece", price: 1450, vat: 14 },
    { key: "board", ar: "لوح تقطيع 60×40", en: "Cutting board 60×40", unit: U.piece, packAr: "قطعة", packEn: "piece", price: 650, vat: 14 },
    { key: "stockpot", ar: "حلة ستانلس 50 لتر", en: "Stainless stockpot 50 L", unit: U.piece, packAr: "قطعة", packEn: "piece", price: 4500, vat: 14, img: "dish-soup" },
    { key: "gn-pan", ar: "صينية GN 1/1 ستانلس", en: "GN 1/1 stainless pan", unit: U.piece, packAr: "قطعة", packEn: "piece", price: 950, vat: 14 },
    { key: "scale", ar: "ميزان ديجيتال 10 كجم", en: "Digital scale 10 kg", unit: U.piece, packAr: "قطعة", packEn: "piece", price: 1100, vat: 14 },
    { key: "fridge", ar: "ثلاجة عرض بابين", en: "Two-door display fridge", unit: U.piece, packAr: "قطعة", packEn: "unit", price: 68000, vat: 14 },
    { key: "oven", ar: "فرن كونفكشن 6 صواني", en: "Convection oven, 6 trays", unit: U.piece, packAr: "قطعة", packEn: "unit", price: 145000, vat: 14, img: "dish-pizza" },
    { key: "fryer", ar: "قلاية زيت حوضين", en: "Twin-tank fryer", unit: U.piece, packAr: "قطعة", packEn: "unit", price: 22000, vat: 14, img: "dish-fries" },
    { key: "blender", ar: "خلاط تجاري 2 لتر", en: "Commercial blender 2 L", unit: U.piece, packAr: "قطعة", packEn: "unit", price: 18500, vat: 14, img: "dish-smoothie" },
    { key: "espresso-machine", ar: "ماكينة إسبريسو 2 جروب", en: "2-group espresso machine", unit: U.piece, packAr: "قطعة", packEn: "unit", price: 210000, vat: 14, img: "dish-espresso" },
    { key: "grinder", ar: "مطحنة بن احترافية", en: "Pro coffee grinder", unit: U.piece, packAr: "قطعة", packEn: "unit", price: 32000, vat: 14, img: "dish-espresso" },
    { key: "thermometer", ar: "ترمومتر طعام ديجيتال", en: "Digital food thermometer", unit: U.piece, packAr: "قطعة", packEn: "piece", price: 450, vat: 14 },
    { key: "shawarma-grill", ar: "ماكينة شاورما غاز", en: "Gas shawarma grill", unit: U.piece, packAr: "قطعة", packEn: "unit", price: 26500, vat: 14, img: "dish-shawarma" },
  ],
};

export interface Supplier {
  id: string;
  ar: string;
  en: string;
  categories: SupplyCategory[];
  areaAr: string;
  areaEn: string;
  /** delivery areas (Cairo districts) */
  zones: string[];
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
  /** order before this hour for next-day delivery */
  cutoff: number;
  /** minimum order, piastres */
  minOrder: number;
  deliveryFee: number;
  rating: number;
  ratings: number;
  since: number;
  verified: boolean;
  /** registered for ETA e-invoicing */
  eInvoice: boolean;
  featured?: boolean;
  phone: string;
  tax: string;
  img: string;
  descAr: string;
  descEn: string;
}

export interface Product {
  id: string;
  supplierId: string;
  category: SupplyCategory;
  key: string;
  ar: string;
  en: string;
  unit: Unit;
  packAr: string;
  packEn: string;
  /** price per unit, piastres, before VAT */
  price: number;
  vat: 0 | 14;
  stock: number;
  minQty: number;
  img?: string;
}

const ZONES = {
  all: ["zamalek", "maadi", "newcairo", "heliopolis", "dokki", "mohandessin", "nasr", "downtown", "sheikhzayed", "october"],
  east: ["newcairo", "heliopolis", "nasr", "maadi", "downtown"],
  west: ["sheikhzayed", "october", "dokki", "mohandessin", "zamalek"],
  central: ["zamalek", "dokki", "mohandessin", "downtown", "garden", "maadi"],
};
export const ZONE_NAMES: Record<string, { ar: string; en: string }> = {
  zamalek: { ar: "الزمالك", en: "Zamalek" },
  maadi: { ar: "المعادي", en: "Maadi" },
  newcairo: { ar: "القاهرة الجديدة", en: "New Cairo" },
  heliopolis: { ar: "مصر الجديدة", en: "Heliopolis" },
  dokki: { ar: "الدقي", en: "Dokki" },
  mohandessin: { ar: "المهندسين", en: "Mohandessin" },
  nasr: { ar: "مدينة نصر", en: "Nasr City" },
  downtown: { ar: "وسط البلد", en: "Downtown" },
  garden: { ar: "جاردن سيتي", en: "Garden City" },
  sheikhzayed: { ar: "الشيخ زايد", en: "Sheikh Zayed" },
  october: { ar: "6 أكتوبر", en: "6th of October" },
};
export const DAY_NAMES = {
  ar: ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

type Seed = Omit<Supplier, "phone" | "tax"> & { pick: Partial<Record<SupplyCategory, number>>; /** fixed template keys for specialists */ only?: string[] };
const seeds: Seed[] = [
  { id: "s01", ar: "خضار وادي النيل", en: "Nile Valley Produce", categories: ["produce"], areaAr: "سوق العبور", areaEn: "Obour Market", zones: ZONES.all, days: [0, 1, 2, 3, 4, 6], cutoff: 20, minOrder: egp(1500), deliveryFee: 0, rating: 4.7, ratings: 412, since: 2009, verified: true, eInvoice: true, featured: true, img: "venue-outdoor-2", descAr: "خضار وفاكهة من سوق العبور كل يوم الفجر، فرز أول.", descEn: "Fruit & veg from Obour Market every dawn, first grade.", pick: { produce: 16 } },
  { id: "s02", ar: "مزارع الريف الطازج", en: "Rif Fresh Farms", categories: ["produce", "dairy"], areaAr: "القليوبية", areaEn: "Qalyubia", zones: ZONES.east, days: [0, 2, 4], cutoff: 18, minOrder: egp(1000), deliveryFee: egp(150), rating: 4.5, ratings: 188, since: 2016, verified: true, eInvoice: false, img: "venue-outdoor-1", descAr: "من المزرعة للمطبخ: خضار ورقية وبيض بلدي ولبن.", descEn: "Farm to kitchen: leafy greens, free-range eggs, milk.", pick: { produce: 8, dairy: 3 } },
  { id: "s03", ar: "العبور للخضار والفاكهة", en: "Obour Greens", categories: ["produce"], areaAr: "العبور", areaEn: "Obour City", zones: ZONES.all, days: [0, 1, 2, 3, 4, 5, 6], cutoff: 22, minOrder: egp(800), deliveryFee: egp(100), rating: 4.3, ratings: 260, since: 2012, verified: true, eInvoice: true, img: "venue-outdoor-3", descAr: "توصيل يومي حتى يوم الجمعة، أسعار جملة الجملة.", descEn: "Daily delivery incl. Fridays, true wholesale prices.", pick: { produce: 14 } },
  { id: "s04", ar: "جزارة الأمانة بالجملة", en: "Al-Amana Wholesale Butchery", categories: ["meat"], areaAr: "البساتين", areaEn: "El Basatin", zones: ZONES.central, days: [0, 1, 3, 5], cutoff: 17, minOrder: egp(3000), deliveryFee: 0, rating: 4.8, ratings: 356, since: 1998, verified: true, eInvoice: true, featured: true, img: "venue-grill-1", descAr: "لحوم بلدي مذبوحة في مجازر معتمدة، تقطيع حسب طلب الشيف.", descEn: "Local beef & lamb from licensed abattoirs, cut to the chef's spec.", pick: { meat: 11 } },
  { id: "s05", ar: "دواجن الدلتا", en: "Delta Poultry", categories: ["meat"], areaAr: "بنها", areaEn: "Banha", zones: ZONES.all, days: [0, 1, 2, 3, 4, 6], cutoff: 19, minOrder: egp(2000), deliveryFee: egp(200), rating: 4.4, ratings: 221, since: 2011, verified: true, eInvoice: true, img: "venue-grill-2", descAr: "فراخ طازة ومبردة، صدور وأوراك وأجنحة.", descEn: "Fresh chilled chicken: breasts, thighs and wings.", only: ["chicken-whole", "chicken-breast", "chicken-thigh", "chicken-liver", "duck", "turkey", "sausage"], pick: { meat: 7 } },
  { id: "s06", ar: "لحوم السلطان", en: "Sultan Meats", categories: ["meat"], areaAr: "مدينة نصر", areaEn: "Nasr City", zones: ZONES.east, days: [1, 3, 5], cutoff: 16, minOrder: egp(2500), deliveryFee: egp(150), rating: 4.2, ratings: 97, since: 2018, verified: false, eInvoice: false, img: "venue-grill-3", descAr: "برجر ولحم شاورما متبل جاهز ومنتجات مصنعة.", descEn: "Burger patties, marinated shawarma and processed meats.", only: ["burger-patty", "shawarma-meat", "sausage", "pastrami", "turkey", "beef-mince", "chicken-breast", "lamb"], pick: { meat: 8 } },
  { id: "s07", ar: "أسماك إسكندرية الطازجة", en: "Alex Fresh Fish", categories: ["fish"], areaAr: "الأنفوشي — إسكندرية", areaEn: "Anfoushi, Alexandria", zones: ZONES.all, days: [0, 2, 4, 6], cutoff: 15, minOrder: egp(2500), deliveryFee: egp(250), rating: 4.6, ratings: 174, since: 2005, verified: true, eInvoice: true, featured: true, img: "venue-seafood-1", descAr: "سمك من حلقة الأنفوشي يوصل القاهرة في نفس اليوم على تلج.", descEn: "Fish from the Anfoushi auction, iced and in Cairo the same day.", pick: { fish: 10 } },
  { id: "s08", ar: "بحر السويس للمأكولات البحرية", en: "Suez Sea Foods", categories: ["fish"], areaAr: "السويس", areaEn: "Suez", zones: ZONES.east, days: [1, 4], cutoff: 14, minOrder: egp(3000), deliveryFee: egp(300), rating: 4.3, ratings: 83, since: 2014, verified: true, eInvoice: false, img: "venue-seafood-2", descAr: "جمبري وكابوريا وكاليماري مجمد بسرعة.", descEn: "Shrimp, crab and quick-frozen calamari.", pick: { fish: 8 } },
  { id: "s09", ar: "ألبان الواحة", en: "Oasis Dairy", categories: ["dairy"], areaAr: "العاشر من رمضان", areaEn: "10th of Ramadan", zones: ZONES.all, days: [0, 1, 2, 3, 4, 6], cutoff: 20, minOrder: egp(1200), deliveryFee: 0, rating: 4.6, ratings: 302, since: 2003, verified: true, eInvoice: true, img: "venue-cafe-2", descAr: "لبن وزبادي وجبن وكريمة بسلسلة تبريد كاملة.", descEn: "Milk, yogurt, cheese and cream with a full cold chain.", pick: { dairy: 11 } },
  { id: "s10", ar: "مزرعة البقرة السعيدة", en: "Happy Cow Dairy", categories: ["dairy"], areaAr: "طريق مصر إسكندرية الصحراوي", areaEn: "Cairo–Alex Desert Rd", zones: ZONES.west, days: [0, 3], cutoff: 18, minOrder: egp(800), deliveryFee: egp(120), rating: 4.8, ratings: 66, since: 2019, verified: true, eInvoice: false, img: "venue-healthy-1", descAr: "ألبان عضوية وموتزاريلا وبارميزان صناعة محلية.", descEn: "Organic dairy, local mozzarella and parmesan.", pick: { dairy: 7 } },
  { id: "s11", ar: "بيت الجبن البلدي", en: "Baladi Cheese House", categories: ["dairy"], areaAr: "شبرا الخيمة", areaEn: "Shubra El Kheima", zones: ZONES.central, days: [1, 3, 5], cutoff: 17, minOrder: egp(700), deliveryFee: egp(80), rating: 4.1, ratings: 140, since: 2001, verified: false, eInvoice: false, img: "venue-egyptian-2", descAr: "جبن فيتا ورومي ولبنة وجبن قريش.", descEn: "Feta, roumi, labneh and cottage cheese.", pick: { dairy: 7 } },
  { id: "s12", ar: "بقالة الجملة المصرية", en: "Egyptian Wholesale Grocers", categories: ["dry"], areaAr: "روض الفرج", areaEn: "Rod El Farag", zones: ZONES.all, days: [0, 1, 2, 3, 4, 6], cutoff: 21, minOrder: egp(2000), deliveryFee: 0, rating: 4.5, ratings: 520, since: 1995, verified: true, eInvoice: true, featured: true, img: "venue-bakery-1", descAr: "كل البقالة الجافة: أرز ومكرونة وزيوت وبقوليات.", descEn: "All dry goods: rice, pasta, oils and pulses.", pick: { dry: 18 } },
  { id: "s13", ar: "مطاحن وتموين الشروق", en: "El Shorouk Mills & Supplies", categories: ["dry"], areaAr: "الشروق", areaEn: "El Shorouk", zones: ZONES.east, days: [0, 2, 4], cutoff: 18, minOrder: egp(2500), deliveryFee: egp(200), rating: 4.4, ratings: 133, since: 2007, verified: true, eInvoice: true, img: "venue-bakery-2", descAr: "دقيق وسميد وسكر وخميرة للمخابز والحلواني.", descEn: "Flour, semolina, sugar and yeast for bakers.", only: ["flour", "semolina", "sugar", "yeast", "vermicelli", "pasta", "kunafa", "chocolate"], pick: { dry: 8 } },
  { id: "s14", ar: "بيت البهارات", en: "The Spice House", categories: ["dry"], areaAr: "الأزهر", areaEn: "Al-Azhar", zones: ZONES.central, days: [1, 4], cutoff: 16, minOrder: egp(500), deliveryFee: egp(60), rating: 4.9, ratings: 211, since: 1982, verified: true, eInvoice: false, img: "venue-egyptian-3", descAr: "بهارات مطحونة طازة من الأزهر ومكسرات.", descEn: "Freshly ground spices from Al-Azhar, plus nuts.", only: ["cumin", "black-pepper", "nuts", "chickpeas", "lentils", "tahini", "salt"], pick: { dry: 7 } },
  { id: "s15", ar: "زيوت الصعيد", en: "Upper Egypt Oils", categories: ["dry"], areaAr: "بني سويف", areaEn: "Beni Suef", zones: ZONES.all, days: [2, 5], cutoff: 15, minOrder: egp(3000), deliveryFee: egp(250), rating: 4.2, ratings: 58, since: 2013, verified: true, eInvoice: true, img: "venue-restaurant-3", descAr: "زيوت طهي وسمن وطحينة بالجملة.", descEn: "Cooking oils, ghee and tahini in bulk.", only: ["sunflower", "olive-oil", "ghee", "tahini", "tomato-paste", "salt", "rice"], pick: { dry: 7 } },
  { id: "s16", ar: "مشروبات القاهرة للتوزيع", en: "Cairo Beverage Distribution", categories: ["drinks"], areaAr: "مدينة السلام", areaEn: "El Salam City", zones: ZONES.all, days: [0, 1, 2, 3, 4, 6], cutoff: 20, minOrder: egp(1500), deliveryFee: 0, rating: 4.3, ratings: 388, since: 2004, verified: true, eInvoice: true, img: "venue-cafe-1", descAr: "مياه ومشروبات غازية وعصائر بأسعار الوكيل.", descEn: "Water, soft drinks and juices at distributor prices.", pick: { drinks: 10 } },
  { id: "s17", ar: "بن بلو نايل للتحميص", en: "Blue Nile Coffee Roasters", categories: ["drinks"], areaAr: "المعادي", areaEn: "Maadi", zones: ZONES.all, days: [0, 3], cutoff: 18, minOrder: egp(1000), deliveryFee: egp(100), rating: 4.9, ratings: 147, since: 2017, verified: true, eInvoice: true, featured: true, img: "venue-coffee-1", descAr: "تحميص أسبوعي، بلند إسبريسو خاص بالكافيه بتاعك.", descEn: "Weekly roasting; a custom espresso blend for your café.", only: ["beans-brazil", "espresso-blend", "turkish", "syrup", "oat-milk", "matcha", "tea-bags"], pick: { drinks: 7 } },
  { id: "s18", ar: "شاي وأعشاب العطار", en: "Al-Attar Tea & Herbs", categories: ["drinks"], areaAr: "باب الخلق", areaEn: "Bab El Khalq", zones: ZONES.central, days: [1, 3, 5], cutoff: 17, minOrder: egp(400), deliveryFee: egp(50), rating: 4.6, ratings: 92, since: 1990, verified: false, eInvoice: false, img: "venue-shisha-1", descAr: "شاي وكركديه وسحلب وأعشاب للمقاهي.", descEn: "Tea, hibiscus, sahlab and herbs for ahwas.", only: ["tea-loose", "tea-bags", "hibiscus", "sahlab", "turkish", "water-small"], pick: { drinks: 6 } },
  { id: "s19", ar: "تغليف بلس", en: "Pack Plus", categories: ["packaging"], areaAr: "العاشر من رمضان", areaEn: "10th of Ramadan", zones: ZONES.all, days: [0, 2, 4], cutoff: 19, minOrder: egp(1500), deliveryFee: 0, rating: 4.5, ratings: 274, since: 2010, verified: true, eInvoice: true, featured: true, img: "venue-burger-1", descAr: "علب ألومنيوم وبلاستيك وطباعة بشعارك.", descEn: "Aluminium & plastic containers, printed with your logo.", pick: { packaging: 12 } },
  { id: "s20", ar: "كرافت باك مصر", en: "Kraft Pack Egypt", categories: ["packaging"], areaAr: "6 أكتوبر", areaEn: "6th of October", zones: ZONES.west, days: [1, 4], cutoff: 17, minOrder: egp(1000), deliveryFee: egp(150), rating: 4.4, ratings: 81, since: 2020, verified: true, eInvoice: true, img: "venue-cafe-4", descAr: "تغليف ورقي صديق للبيئة للكافيهات.", descEn: "Eco paper packaging for cafés.", only: ["kraft-bags", "cups-8", "lids", "cutlery", "napkins", "pizza-box", "burger-box", "sauce-cups"], pick: { packaging: 8 } },
  { id: "s21", ar: "نظافة برو", en: "Clean Pro", categories: ["cleaning"], areaAr: "مصر الجديدة", areaEn: "Heliopolis", zones: ZONES.all, days: [0, 2, 4], cutoff: 18, minOrder: egp(800), deliveryFee: egp(100), rating: 4.4, ratings: 165, since: 2015, verified: true, eInvoice: true, img: "venue-restaurant-1", descAr: "منظفات ومطهرات معتمدة للمطابخ التجارية.", descEn: "Certified detergents & sanitisers for commercial kitchens.", pick: { cleaning: 10 } },
  { id: "s22", ar: "كيماويات المنار للتنظيف", en: "Al-Manar Cleaning Chemicals", categories: ["cleaning"], areaAr: "العبور الصناعية", areaEn: "Obour Industrial", zones: ZONES.east, days: [1, 3], cutoff: 16, minOrder: egp(1200), deliveryFee: 0, rating: 4.0, ratings: 61, since: 2008, verified: false, eInvoice: true, img: "venue-restaurant-2", descAr: "مصنع منظفات، جراكن 20 لتر بأسعار المصنع.", descEn: "Detergent maker: 20 L jerrycans at factory prices.", pick: { cleaning: 8 } },
  { id: "s23", ar: "معدات المطابخ الحديثة", en: "Modern Kitchen Equipment", categories: ["equipment"], areaAr: "شارع الجيش", areaEn: "El Geish St.", zones: ZONES.all, days: [0, 1, 2, 3, 4], cutoff: 15, minOrder: 0, deliveryFee: egp(300), rating: 4.5, ratings: 120, since: 1999, verified: true, eInvoice: true, img: "venue-restaurant-4", descAr: "أفران وقلايات وثلاجات مع تركيب وضمان.", descEn: "Ovens, fryers and fridges with installation & warranty.", pick: { equipment: 11 } },
  { id: "s24", ar: "ستانلس للتجهيزات الفندقية", en: "Stainless Hotel Supplies", categories: ["equipment"], areaAr: "الموسكي", areaEn: "Al-Muski", zones: ZONES.central, days: [0, 2, 4], cutoff: 17, minOrder: egp(500), deliveryFee: egp(100), rating: 4.3, ratings: 77, since: 1987, verified: true, eInvoice: false, img: "venue-restaurant-5", descAr: "حلل وصواني وسكاكين وأدوات مطبخ.", descEn: "Pots, pans, knives and smallwares.", pick: { equipment: 8 } },
  { id: "s25", ar: "الموزّع الشامل", en: "All-in-One Distributor", categories: ["dry", "drinks", "packaging", "cleaning", "dairy"], areaAr: "طريق السويس", areaEn: "Suez Road", zones: ZONES.all, days: [0, 1, 2, 3, 4, 6], cutoff: 21, minOrder: egp(5000), deliveryFee: 0, rating: 4.2, ratings: 610, since: 2002, verified: true, eInvoice: true, img: "venue-exterior-2", descAr: "كل احتياجات المطعم في طلب واحد وعربية واحدة.", descEn: "Everything a restaurant needs in one order, one truck.", pick: { dry: 6, drinks: 4, packaging: 4, cleaning: 3, dairy: 3 } },
];

/** Deterministic pseudo-random in [0,1) from a string (stable across builds). */
function rnd(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Round a pound price to a shelf-looking value (x.50 under 100 EGP, whole pounds above, 5s above 1,000). */
function shelf(pounds: number): number {
  if (pounds < 100) return Math.round(pounds * 2) / 2;
  if (pounds < 1000) return Math.round(pounds);
  return Math.round(pounds / 5) * 5;
}

export const SUPPLIERS: Supplier[] = seeds.map(({ pick: _p, only: _o, ...s }, i) => ({
  ...s,
  phone: `01${[0, 1, 2, 5][i % 4]}${String(10000000 + Math.floor(rnd(s.id + "ph") * 89999999)).slice(0, 8)}`,
  tax: `${200 + i}-${String(Math.floor(rnd(s.id + "tx") * 900) + 100)}-${String(Math.floor(rnd(s.id + "ty") * 900) + 100)}`,
}));

export const PRODUCTS: Product[] = seeds.flatMap((s) =>
  (Object.entries(s.pick) as [SupplyCategory, number][]).flatMap(([cat, n]) => {
    const list = s.only ? T[cat].filter((t) => s.only!.includes(t.key)) : [...T[cat]].sort((a, b) => rnd(s.id + a.key) - rnd(s.id + b.key)).slice(0, n);
    return list.map((t): Product => {
      const r = rnd(s.id + t.key + "p");
      const price = egp(shelf(t.price * (0.92 + r * 0.16)));
      const big = t.price >= 10000;
      return {
        id: `${s.id}-${t.key}`,
        supplierId: s.id,
        category: cat,
        key: t.key,
        ar: t.ar,
        en: t.en,
        unit: t.unit,
        packAr: t.packAr,
        packEn: t.packEn,
        price,
        vat: t.vat,
        stock: big ? 1 + Math.floor(r * 8) : Math.floor(20 + rnd(t.key + s.id + "s") * 380),
        minQty: big ? 1 : t.unit === U.kg ? [2, 3, 5, 5, 10][Math.floor(r * 5)] : 1,
        img: t.img,
      };
    });
  }),
);

export const supplierById: Record<string, Supplier> = Object.fromEntries(SUPPLIERS.map((s) => [s.id, s]));
export const productById: Record<string, Product> = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

/** Same item from every supplier that carries it, cheapest first (for "compare prices"). */
export function offersFor(key: string): Product[] {
  return PRODUCTS.filter((p) => p.key === key).sort((a, b) => a.price - b.price);
}

/** The demo supplier the supplier portal signs in as. */
export const DEMO_SUPPLIER_ID = "s01";
