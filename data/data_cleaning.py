import pandas as pd

# load original dataset
df = pd.read_csv('data/movie_dataset.csv')

# filter the rows to only include when year is 2010-2019
df['year'] = pd.to_numeric(df['year'], errors='coerce') 
filtered_df = df[df['year'].between(2010, 2019)]

# columns to keep
columns = ['movie', 'year', 'production_budget', 'worldwide_gross', 'month', 'profit', 'release_date', 'genre_list', 'genres', 'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 'TV Movie', 'Thriller', 'War', 'Western']

# make new dataframe with only those columns
cleaned_df = filtered_df[columns]

# rename worldwide gross to gross revenue
cleaned_df = cleaned_df.rename(columns={'worldwide_gross': 'gross_revenue'})

# save to a new CSV (index=False prevents adding an extra row-number column)
cleaned_df.to_csv('data/cleaned_movie_dataset.csv', index=False)

print("cleaned file")